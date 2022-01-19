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
 * @typedef {function(TxGenerator<InT,InReturnT>):TxGenerator<OutT,OutReturnT>} TxOp
 */
export let TxOp;

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
 * @enum {number}
 */
const TxState = {
  Open: 0,
  Closing: 1,
  Closed: 2,
};

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
     * Set this value if you would like to run code on close. Closing happens
     * when the TxOutput sends a complete, sends an error, or is abandoned
     * @type {?function():void}
     */
    this.onClose = null;

    /**
     * This is an odd field
     */
    this._queueEnd = null;
    this._nextIndex = 0;

    /**
     * Whether or not the element is closed.
     * @type {boolean}
     */
    this._state = TxState.Open;

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

  /**
   * Ends the output with the given error
   * @param {*} error
   */
  error(error) {
    runEvent(this, { done: "error", value: error });
  }

  /**
   * Sends the iterator as-is straight down to the child.
   * If `iter.done` is truthy, the output will end
   * @param {Iteration<T, ReturnT>} iter
   */
  iter(iter) {
    runEvent(this, iter);
  }

  /**
   * This function will cease all future outputs, as well as that of its parent
   * (and so on), calling the various onClose methods that are defined (in
   * first-most parent to this output order).
   *
   * It is ok to call this function multiple times, it is idempotent and will do
   * nothing if the TxOutput was already abandoned.
   */
  abandon() {
    if (this._state === TxState.Closed) {
      return;
    }
    this._state = TxState.Closed;
    this._queueEnd = null;

    const closers = [];

    let tx = this;
    while (tx) {
      const parent = tx._parent;
      const onClose = tx.onClose;
      onClose && closers.push(onClose);

      tx._state = TxState.Closed;
      tx._child = null;
      tx._parent = null;
      tx = parent;
    }

    let i = closers.length;
    while (i) {
      try {
        closers[--i]();
      } catch (error) {
        uncaughtErrorWhileRunning(error);
      }
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
  if (output._state !== TxState.Open) {
    // todo silently do nothing
    console.error(`Tried sending output after finished`);
    // throw new Error("STA");
    return;
  }

  if (iteration.done) {
    output._state = TxState.Closing;
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
    const { iteration, index, nextEvent } = active;

    if (iteration.done) {
      output.abandon();
    }

    // set it to null, if we are successful then it gets set to nextEvent
    active = null;

    const handler = child.controller;
    if (handler) {
      try {
        handler(iteration, index);
        active = nextEvent;
      } catch (error) {
        // is idempotent
        output.abandon();

        if (child._state === TxState.Open) {
          child.error(error);
        } else {
          // no where for the error to go
          uncaughtErrorWhileRunning(error);
        }
      }
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

// /**
//  *
//  * @template T
//  * @template ReturnT
//  * @param {SyncStream<T,ReturnT>} stream
//  * @param {Handler<T,ReturnT>} handler
//  */
// function subscribe(stream, handler) {
//   const child = makeChild(handler, stream._output._queueEnd?.iteration);

//   let children = stream._children;
//   if (children && children.handler) {
//     // a while loop is gross, but the assumption is that we rarely actually have
//     // more than one subscriber
//     while (children.nextChild) {
//       const nextChild = children.nextChild;

//       if (nextChild.handler) {
//         children = children.nextChild;
//       } else {
//         children.nextChild = nextChild.nextChild;
//       }
//     }
//     children.nextChild = child;
//   } else {
//     stream._children = child;
//   }

//   // todo, trigger something
// }

export class TxSubscription {
  /**
   * Creates an TxSubscription that exposes the abandon command
   * @param {TxOutput<*,*,*,*>} chain
   * @private
   */
  constructor(chain) {
    /**
     * Abandon the subscription, no more events will fire within it
     * @type {function():void}
     * @readonly
     * @public
     */
    this.abandon = () => chain.abandon();

    /**
     * Whether or not the subscription completed without error
     * @type {boolean}
     * @public
     */
    this.completed = false;
  }
}

/**
 * An Async Generator
 * @template T
 * @template ReturnT
 */
export class TxGenerator {
  /**
   * Do not use this function directly, instead use {@link makeTx},
   * {@link runTx}, or {@link makeTxOp}.
   * @private
   */
  constructor(parent, code) {
    this._parent = parent;
    this._open = code;
  }

  /**
   * Starts the generator
   * @param {?function(T,number):void=} onNext Called when the generator outputs a value
   * @param {?function(ReturnT,number):void=} onComplete Called when the generator completes
   * @param {?function(*):void} onError Called when the generator errors
   * @returns {TxSubscription}
   */
  run(onNext, onComplete, onError) {
    const base = new TxOutput(null);
    let top = new TxOutput(base);
    let gen = this;
    let parent = gen._parent;
    while (parent) {
      // run the child
      const code = gen._open;
      top.controller = code(top);

      top = new TxOutput(top);

      gen = parent;
      parent = parent._parent;
    }

    // set up the subscription
    const sub = new TxSubscription(top);
    base.controller = ({ done, value }, index) => {
      if (done === true) {
        sub.completed = true;
        onComplete?.(value, index);
      } else if (done) {
        (onError || uncaughtErrorWhileRunning)(value);
      } else {
        onNext?.(value, index);
      }
    };

    // actually start the output stream
    const code = gen._open;
    code(top);

    return sub;
  }

  pipe(...ops) {
    return ops.reduce((acc, op) => (op ? op(acc) : acc), this);
  }
}

/**
 * Creates a generator that will call the code when the user calls open
 *
 * @template T
 * @template ReturnT
 * @param {function(TxOutput<T,ReturnT>):void} code
 * @returns {TxGenerator<T,ReturnT>}
 */
export function makeTx(code) {
  return new TxGenerator(null, code);
}

/**
 * Runs the given generator with a function that sees the raw iterator values.
 * This is a bit more advanced, but it enables unsubscribing while receiving
 * values synchronously.
 * @template InT
 * @template InReturnT
 * @template T
 * @template ReturnT
 * @param {TxGenerator<InT,InReturnT>} gen
 * @param {function(TxOutput<T,ReturnT>):Handler<InT,InReturnT>} code
 * @returns {TxSubscription}
 */
export function runTx(gen, code) {
  return new TxGenerator(gen, code).run();
}

/**
 *
 * @template InT
 * @template InReturnT
 * @template T
 * @template ReturnT
 * @param {function(TxOutput<T,ReturnT>):Handler<InT,InReturnT>} code
 * @returns {TxOp<InT,InReturnT,T,ReturnT>}
 */
export function makeTxOp(code) {
  return (input) => new TxGenerator(input, code);
}

function uncaughtErrorWhileRunning(error) {
  // hopefully the user will get a visual report
  Promise.reject(error);
}

export function pipe(gen, ...ops) {
  return ops.reduce((acc, op) => (op ? op(acc) : acc), gen);
}

export const EMPTY = makeTx((output) => {
  output.complete();
});
