/**
 * This file is the core of the library, without the operators
 * @file
 */

/**
 * A wrapper used to indicate that an error occurred. Because it is an object,
 * it is always truthy.
 * @typedef {{error: *}} DidError
 */
let DidError;

/**
 * Internally, data within the observables is held within these Iteration
 * objects, which are designed to look like javascripts' standard iterations.
 * @template T
 * @typedef {{done:false,value:T}|{done:true,value:void|DidError}} Iteration
 */
let Iteration;

/**
 * Handlers are functions that get called with the value of the iteration and
 * the index of the iteration.
 * @template T
 * @typedef {function(Iteration<T>,number):void} Handler
 */
let Handler;

/**
 * @template T
 * @typedef {{nextEvent: ?IterRound, iteration: Iteration<T>}} IterRound
 */
let IterRound;

/**
 * An operator takes in an Observable and outputs an Observable
 * @template InT
 * @template OutT
 * @typedef {function(TxObservable<InT>):TxObservable<OutT>} TxOp
 */
export let TxOp;

/**
 * Subscribers to a stream are held in a linked-list of their handlers. If the
 * handler is set to null, that means that the user tried unsubscribing and we
 * just need to clear it from the list
 *
 * @template T
 * @typedef {{handler:?Handler<T>, addedAfter:?IterRound<T>, nextChild:?Child<T>}} Child
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
 * This class represents a step in a running observable (a stream).
 * @template InT
 * @template OutT The type of the values
 */
class TxStep {
  /** @private */
  constructor(child) {
    /**
     * The current handler for the output
     * @type {?Handler<InT>}
     */
    this.controller = null;

    /**
     * Set this value if you would like to run code on close. Closing happens
     * when the TxStep sends a complete, sends an error, or is abandoned
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
     * The parent for this TxStep, used to close everything.
     * @type {?TxStep<InT,*>}
     */
    this._parent = null;

    /**
     * When an event occurs, it will call the child's controller.
     * The child will change to null when it dies
     * @type {?TxStep<OutT,*>}
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
   */
  complete() {
    runEvent(this, { done: true, value: undefined });
  }

  /**
   * Ends the output with the given error
   * @param {*} error
   */
  error(error) {
    runEvent(this, { done: true, value: { error } });
  }

  /**
   * Sends the iterator as-is straight down to the child.
   * If `iter.done` is truthy, the output will end
   * @param {Iteration<T>} iter
   */
  iter(iter) {
    runEvent(this, iter);
  }

  /**
   * This function will cease all future outputs, as well as that of its parent
   * (and so on), calling the various onClose methods that are defined (in
   * "first-most parent to this step" order).
   *
   * It is ok to call this function multiple times, it is idempotent and will do
   * nothing if the TxStep was already abandoned.
   */
  abandon() {
    if (this._state === TxState.Closed) {
      return;
    }

    const closers = [];

    let tx = this;
    while (tx) {
      const parent = tx._parent;
      const onClose = tx.onClose;
      onClose && closers.push(onClose);

      tx._queueEnd = null;
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
 * This {@link TxStep} fired an event, so we need to invoke its child. However,
 * its child may run code that fires an event _while this function is running_.
 * In that situation, the inner call will only queue an event, which will be run
 * once control returns to this outer event.
 *
 * Additionally, if an event is fired with {@link Iteration.done} set to
 * `true`, then the {@link TxStep.abandon} method will be invoked immediately
 * before calling the child.
 *
 * @template T
 * @param {TxStep<*,T>} step The object that is sending the value down to its child
 * @param {Iteration<T>} iteration The value to send
 */
function runEvent(step, iteration) {
  if (step._state !== TxState.Open) {
    // todo silently do nothing
    console.error(`Tried sending output after finished`);
    // throw new Error("STA");
    return;
  }

  if (iteration.done) {
    step._state = TxState.Closing;
  }

  const child = step._child;
  if (!child) return;

  const queueNode = {
    nextEvent: null,
    iteration,
    index: step._nextIndex++,
  };

  const pending = step._queueEnd;
  step._queueEnd = queueNode;

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
      step.abandon();
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
        step.abandon();

        if (child._state === TxState.Open) {
          child.error(error);
        } else {
          // no where for the error to go
          uncaughtErrorWhileRunning(error);
        }
      }
    }
  }

  step._queueEnd = null;
}

/**
 * Synchronously emits to its children.
 * @template T The type of each non-return iteration
 */
class SyncSubject {
  constructor() {
    /**
     * The active listeners
     * @type {?Child}
     * @private
     */
    this._children = null;

    const handler = new TxStep(null);
    handler.controller = (iteration, index) => {
      notifySubscribers(this, iteration, index);
    };

    this._output = new TxStep(handler);
  }

  /**
   * Synchronously sends the value to any of its listeners
   * @param {T} val
   */
  next(val) {
    this._output.next(val);
  }

  /**
   * Ends the Subject
   */
  complete() {
    this._output.complete();
  }

  error(error) {
    this._output.error(error);
  }

  subscribe(handler) {
    new TxObservable();
  }
}

/**
 * @template T
 * @param {SyncSubject<T>} subject
 * @param {T} iteration
 * @param {number} index
 */
function notifySubscribers(subject, iteration, index) {
  const firstChild = subject._children;

  // skip to the first actual handler
  let child = firstChild;
  while (child && !child.handler) {
    child = child.nextChild;
  }

  // actually remove the skipped handlers (null case implicitly handled)
  if (child !== firstChild) {
    subject._children = child;
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

/**
 * Presents a function which allows you to unsubscribe from a stream
 */
export class TxSubscription {
  /**
   * Creates an TxSubscription that exposes the unsubscribe command
   * @param {TxStep<*,*>} chain
   * @private
   */
  constructor(chain) {
    /**
     * Ends the subscription, no more events will fire within it
     * @type {function():void}
     * @readonly
     * @public
     */
    this.unsubscribe = () => {
      this.unsubscribe = noop;
      chain.abandon();
    };
  }
}

/**
 * The main Observable class. It does nothing until subscribed to.
 * @template T
 */
export class TxObservable {
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
   * Starts the observable
   * @param {{next?:function(T):void, complete?:function():void, error?:function(*):void}|function(T):void} handler
   * @returns {TxSubscription}
   */
  subscribe(handler) {
    const base = endWithHandler(handler);
    let top = new TxStep(base);
    let gen = this;
    let parent = gen._parent;
    while (parent) {
      // TODO: we may need to check that top is not closed

      // run the child
      const code = gen._open;
      top.controller = code(top);

      top = new TxStep(top);

      gen = parent;
      parent = parent._parent;
    }

    // set up the subscription
    const sub = new TxSubscription(base);

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
 * @param {function(TxStep<T,ReturnT>):void} code
 * @returns {TxObservable<T,ReturnT>}
 */
export function makeTx(code) {
  return new TxObservable(null, code);
}

/**
 * Runs the given generator with a function that sees the raw iterator values.
 * This is a bit more advanced, but it enables unsubscribing while receiving
 * values synchronously.
 * @template InT
 * @template T
 * @param {TxObservable<InT>} gen
 * @param {function(TxStep<T,*>):Handler<InT>} code
 * @returns {TxSubscription}
 */
export function runTx(gen, code) {
  return new TxObservable(gen, code).subscribe();
}

/**
 *
 * @template InT
 * @template T
 * @param {function(TxStep<T,ReturnT>):Handler<InT>} code
 * @returns {TxOp<InT,T>}
 */
export function makeTxOp(code) {
  return (input) => new TxObservable(input, code);
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

function noop() {}

/**
 *
 * @param {{next?:function(T):void, complete?:function():void, error?:function(*):void}|function(T):void=} handler
 */
function endWithHandler(handler) {
  let onNext, onComplete, onError;
  if (handler && typeof handler === "object") {
    onNext = handler.next;
    onComplete = handler.complete;
    onError = handler.error;
  } else {
    onNext = handler;
  }

  const endStep = new TxStep(null);
  endStep.controller = ({ done, value }) => {
    if (done) {
      if (value) {
        (onError || uncaughtErrorWhileRunning)(value.error);
      } else {
        onComplete?.();
      }
    } else {
      onNext?.(value);
    }
  };

  return endStep;
}
