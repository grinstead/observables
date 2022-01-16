/**
 * This file is the core of the library, without the operators
 * @file
 */

/**
 * The type of the standard return of iterator.next() in JS
 * @template T The type of each of the non-return iterations
 * @template ReturnT The type of the return iteration
 * @typedef {{done:false,value:T}|{done:true,value:ReturnT}|{done:"error",value:*}} Iteration
 */
let Iteration;

/**
 * @template T
 * @template ReturnT
 * @typedef {function(Iteration<T,ReturnT>,number):void} Handler
 */
let Handler;

/**
 * @typedef {{nextEvent: ?IterRound, iteration: Iteration<*,*>}} IterRound
 */
let IterRound;

/**
 * @template InT
 * @template InReturnT
 * @template OutT
 * @template OutReturnT
 * @typedef {function(AsyncGen<InT,InReturnT>):AsyncGen<OutT,OutReturnT>} TxOp
 */
let TxOp;

/**
 * Subscribers are held in a linked-list of their handlers. If the handler is
 * set to null, that means that the user tried unsubscribing and we just need to
 * clear it from the list
 */
/**
 * @typedef {{
 *  handler: ?Handler<*,*>,
 *  addedAfter: ?IterRound,
 *  nextChild: ?Child,
 * }} Child
 */
let Child;

/**
 * Internal method to make child object.
 * @param {Handler<*,*>} handler
 * @returns {Child}
 */
function makeChild(handler, addedAfter) {
  return {
    handler,
    addedAfter,
    nextChild: null,
  };
}

/**
 * Represents where an invoked generator outputs to.
 * @template T The type of each non-return iteration
 * @template ReturnT The final return type
 * @template InT
 * @template InReturnT
 */
class TxOutput {
  /** @private */
  constructor(child) {
    /**
     * The current handler for the output
     * @type {?Handler<InT,InReturnT>}
     */
    this.controller = null;

    /**
     * Set this value if you would like to run code on close
     * @type {?function():void}
     */
    this.onClose = null;

    /**
     * This is an odd field
     */
    this._queueEnd = null;
    this._nextIndex = 0;

    /**
     * When this is non-null, it is the closing iteration.
     * @type {?Iteration<T,ReturnT>}
     */
    this._finalIter = null;

    /**
     * The parent for this TxOutput, used to close everything.
     * @type {?TxOutput<*,*,InT,ReturnT>}
     */
    this._parent = null;

    /**
     * When an event occurs, it will call the child's controller.
     * The child will change to null when it dies
     * @type {?TxOutput<*,*,T,ReturnT>}
     */
    this._child = child;

    if (child) child._parent = this;
  }

  /**
   * Synchronously sends down the value
   * @param {T} val
   */
  next(value) {
    runEvent(this, { done: false, value });
  }

  /**
   * Ends the output with the given return value
   * @param {ReturnT} returnVal
   */
  complete(returnVal) {
    runEvent(this, { done: true, value: returnVal });
  }

  error(error) {
    runEvent(this, { done: "error", value: error });
  }

  iter(iter) {
    // I would rather clone the iter than send it down straight
    // so this is just a convenience method
    const { done, value } = iter;

    if (!done) {
      this.next(value);
    } else if (done === true) {
      this.complete(value);
    } else {
      this.error(value);
    }
  }

  close() {
    // TODO: ignore multiple calls

    const closers = [];

    let tx = this;
    while (tx) {
      const parent = tx._parent;
      const onClose = tx.onClose;
      onClose && closers.push(onClose);

      tx._child = null;
      tx._parent = null;
      tx = parent;
    }

    const length = closers.length;
    for (let i = 0; i < length; i++) {
      // if it throws an exception, then at least we have
      // already disabled the chain
      closers[i]();
    }
  }
}

/**
 *
 * @template T
 * @template ReturnT
 * @param {TxOutput<T,ReturnT>} output
 * @param {Iteration<T,ReturnT>} iteration
 * @returns
 */
function runEvent(output, iteration) {
  if (output._finalIter) {
    // todo throw error
    console.error(`Tried sending output after finished`);
    return;
  }

  if (iteration.done) {
    output._finalIter = iteration;
  }

  const child = output._child;
  if (!child) return;

  const queueNode = {
    nextEvent: null,
    iteration,
    index: output._nextIndex++,
  };

  const pending = output._queueEnd;
  output._queueEnd = queueNode;

  // if there is already code calling, then just add our iteration to the queue
  if (pending) {
    pending.nextEvent = queueNode;
    return;
  }

  // There is not already a runEvent working, so we are the one in charge

  // run through the queue, it is allowed to grow as we go
  let active = queueNode;
  while (active) {
    const handler = child.controller;
    if (handler) {
      try {
        handler(active.iteration, active.index);
        active = active.nextEvent;
      } catch (error) {
        output._child = null;
        active = null; // kills the loop
        child.error(error);
      }
    } else {
      active = null; // kill the loop
    }
  }

  output._queueEnd = null;
}

/**
 * A stream represents ongoing data. The stream can be passed data as it comes
 * in through the {@link Stream.next} method.
 * @template T The type of each non-return iteration
 * @template ReturnT The final return type
 */
class SyncStream {
  constructor() {
    /**
     * The active listeners
     * @type {?Child}
     * @private
     */
    this._children = null;

    this._output = new TxOutput((iteration, index) => {
      const firstChild = this._children;

      // skip to the first actual handler
      let child = firstChild;
      while (child && !child.handler) {
        child = child.nextChild;
      }

      // actually remove the skipped handlers (null case implicitly handled)
      if (child !== firstChild) {
        stream._children = child;
      }

      let prevChild = null;
      while (child) {
        const { handler, addedAfter, nextChild } = child;
        if (!handler) {
          // Remove this child. Note that prevChild will not
          // be null because we know that the first child we run
          // on will have a handler
          prevChild.nextChild = nextChild;
          // do not update the prevChild
        } else if (addedAfter) {
          // the value is non-null only if the child was put in to the list while
          // we processing previous events, so we do not call the handler

          // if we have caught up to when the child was added, then get rid of the
          // guard value
          if (addedAfter === iteration) {
            child.addedAfter = null;
            prevChild = child;
          }
        } else {
          // todo: handle errors
          handler(iteration, index);
          prevChild = child;
        }

        child = nextChild;
      }
    }, null);
  }

  /**
   * Synchronously sends the value to any of its listeners
   * @param {T} val
   */
  next(val) {
    this._output.next(val);
  }

  /**
   * Ends the stream with the given return value
   * @param {ReturnT} returnVal
   */
  complete(returnVal) {
    this._output.return(returnVal);
  }

  error(error) {
    this._output.error(error);
  }
}

/**
 *
 * @template T
 * @template ReturnT
 * @param {SyncStream<T,ReturnT>} stream
 * @param {Handler<T,ReturnT>} handler
 */
function subscribe(stream, handler) {
  const child = makeChild(handler, stream._output._queueEnd?.iteration);

  let children = stream._children;
  if (children && children.handler) {
    // a while loop is gross, but the assumption is that we rarely actually have
    // more than one subscriber
    while (children.nextChild) {
      const nextChild = children.nextChild;

      if (nextChild.handler) {
        children = children.nextChild;
      } else {
        children.nextChild = nextChild.nextChild;
      }
    }
    children.nextChild = child;
  } else {
    stream._children = child;
  }

  // todo, trigger something
}

class AsyncIteration {
  /**
   *
   * @param {TxOutput<*,*,*,*>} chain
   * @private
   */
  constructor(chain) {
    this.close = () => chain.close();
  }
}

/**
 * An Async Generator
 * @template T
 * @template ReturnT
 */
class AsyncGen {
  /**
   * @private
   */
  constructor(parent, code) {
    this._parent = parent;
    this._open = code;
  }

  /**
   * Starts the generator
   */
  open() {
    const base = new TxOutput(null);

    let gen = this;
    let parent = gen._parent;
    let top = base;

    while (parent) {
      // run the child
      const handler = gen._open(top);
      top.controller = handler;

      top = new TxOutput(top);

      gen = parent;
      parent = parent._parent;
    }

    // actually start the output stream
    gen._open(top);

    return new AsyncIteration(top);
  }
}

/**
 * Creates a generator that will call the code when the user calls open
 *
 * @template T
 * @template ReturnT
 * @param {function(TxOutput<T,ReturnT>):void} code
 * @returns {AsyncGen<T,ReturnT>}
 */
export function makeTx(code) {
  return new AsyncGen(null, code);
}

/**
 *
 * @template InT
 * @template InReturnT
 * @template T
 * @template ReturnT
 * @param {function(TxOutput<T,ReturnT>,function():void):Handler<InT,InReturnT>} code
 * @returns {TxOp<InT,InReturnT,T,ReturnT>}
 */
export function makeTxOp(code) {
  return (input) => new AsyncGen(input, code);
}

export function of(...args) {
  return makeTx((output) => {
    args.forEach((x) => output.next(x));
  });
}

function map(mapper) {
  return makeTxOp((output) => (iter) => {
    try {
      output.next(mapper(iter.value));
    } catch (error) {
      output.error(error);
    }
  });
}
