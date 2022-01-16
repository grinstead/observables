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

function makeIter(done, value) {
  return { done, value };
}

/**
 * @template T
 * @template ReturnT
 * @typedef {function(Iteration<T,ReturnT>):void} Handler
 */
let Handler;

/**
 * @typedef {{nextEvent: ?IterRound, iteration: Iteration<*,*>}} IterRound
 */
let IterRound;

/**
 * @typedef {function():void} CloseFunc
 */
let CloseFunc;

/**
 * Subscribers are held in a linked-list of their handlers. If the handler is
 * set to null, that means that the user tried unsubscribing and we just need to
 * clear it from the list
 */
/**
 * @typedef {{
 *  handler: ?function(Iteration<*,*>):void,
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
 */
class TxOutput {
  constructor(handler) {
    /**
     * This should only change to null
     * @type {?function(Iteration<T,ReturnT>,number):void}
     */
    this.handler = handler;

    /**
     * Set this value if you would like to run code on close
     * @type {?function():void}
     */
    this.close = null;

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
  }

  /**
   * Synchronously sends down the value
   * @param {T} val
   */
  next(value) {
    runEvent(this, { done: false, value });
  }

  /**
   * Equivalent to {@link TxOutput.return} getting passed undefined
   */
  complete() {
    this.return();
  }

  /**
   * Ends the output with the given return value
   * @param {ReturnT} returnVal
   */
  return(returnVal) {
    runEvent(this, { done: true, value: returnVal });
  }

  error(error) {
    runEvent(this, { done: "error", value: error });
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
  for (let active = queueNode; active; active = active.nextEvent) {
    const handler = output._handler;
    handler && handler(active.iteration, active.index);
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

    const output = new TxOutput();
    this._output = output;

    output.handler = (iteration, index) => {
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
          // this code is guaranteed not to throw because it is wrapped elsewhere
          handler(iteration, index);
          prevChild = child;
        }

        child = nextChild;
      }
    };
  }

  /**
   * Synchronously sends the value to any of its listeners
   * @param {T} val
   */
  next(val) {
    this._output.next(val);
  }

  /**
   * Ends the stream. Equivalent to call return(undefined)
   */
  complete() {
    this.return();
  }

  /**
   * Ends the stream with the given return value
   * @param {ReturnT} returnVal
   */
  return(returnVal) {
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
   * @param {Array<TxOutput<*,*>>} chain
   * @private
   */
  constructor(chain) {
    function close() {
      // first disable the chain
      chain.forEach((output) => {
        output.handler = null;
      });

      // now run the user code
      chain.forEach((output) => {
        const close = output.close;
        close && close();
      });
    }

    this.close = close;
  }
}

/**
 * An Async Generator
 * @template ArgT
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
   * @param {ArgT} arg
   */
  open(arg) {
    let output = new TxOutput(null);
    const chain = [output];

    let gen = this;
    let parent = gen._parent;

    while (parent) {
      const handler = gen._open(output);

      output = new TxOutput(handler);
      chain.push(output);

      gen = parent;
      parent = parent._parent;
    }

    // actually start the output stream
    gen._open(output, arg);

    return new AsyncIteration(chain);
  }
}

/**
 * Creates a generator that will call the code when the user calls open
 *
 * @template T
 * @template ReturnT
 * @template ArgT
 * @param {function(ArgT, SyncStream<T,ReturnT>):?CloseFunc} code
 * @returns {AsyncGen<T,ReturnT,ArgT>}
 */
function makeRootGen(code) {
  return new AsyncGen(null, code);
}

/**
 *
 * @template InT
 * @template InReturnT
 * @template T
 * @template ReturnT
 * @template ArgT
 * @param {AsyncGen<InT,InReturnT,ArgT>} parent
 * @param {function(SyncStream<InT,InReturnT>,SyncStream<T,ReturnT>):?CloseFunc} code
 * @returns {AsyncGen<T,ReturnT,ArgT>}
 */
function makeChildGen(parent, code) {
  return new AsyncGen(parent, code);
}

function of(...args) {
  return makeRootGen((output) => {
    args.forEach((x) => output.next(x));
  });
}

function map(mapper) {
  return (input) =>
    makeChildGen(input, (output) => (iteration) => {
      if (iteration.done) return iteration;

      try {
        output.next(mapper(val));
      } catch (error) {
        output.error(error);
      }
    });
}
