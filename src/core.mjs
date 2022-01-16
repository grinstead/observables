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

    /**
     * This is an odd field
     */
    this._queueEnd = null;

    /**
     * If this is non-null, then the stream has finished
     * with that value
     * @type {?Iteration}
     */
    this._finishedIter = null;
  }

  /**
   * Synchronously sends the value to any of its listeners
   * @param {T} val
   */
  next(val) {
    if (this._finishedIter) {
      // todo: throw error
      console.warn(`Stream has already finished, cannot give next`);
      return;
    }

    this._activeRun = true;
    runHandlers(stream, makeIter(false, val));
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
    if (this._finishedIter) {
      // todo: throw error
      console.warn(`Stream has already finished, cannot return twice`);
      return;
    }

    const finishedIter = makeIter(true, returnVal);
    this._finishedIter = finishedIter;
    runHandlers(stream, finishedIter);
  }

  error(error) {
    if (this._finishedIter) {
      // todo: throw error
      console.warn(`Stream has already finished, cannot error`);
      return;
    }

    const finishedIter = makeIter("error", error);
    this._finishedIter = finishedIter;
    runHandlers(stream, finishedIter);
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
  const child = makeChild(handler, stream._queueEnd);

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

/**
 *
 * @param {SyncStream} stream
 * @param {Iteration<*,*>} iteration
 * @returns
 */
function runHandlers(stream, iteration) {
  const queueNode = {
    nextEvent: null,
    iteration,
  };

  const pending = stream._queueEnd;
  stream._queueEnd = queueNode;

  // if there is already code calling, then just add our iteration to the queue
  if (pending) {
    pending.nextEvent = queueNode;
    return;
  }

  // There is not already a runHandlers working, so we are the one in charge

  // run through the queue, it is allowed to grow as we go
  for (let active = queueNode; active; active = queueNode.nextEvent) {
    const firstChild = stream._children;

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
        if (addedAfter === active) {
          child.addedAfter = null;
          prevChild = child;
        } else {
          // we know that anything after this child is just going to be ignored,
          // might as well skip them and move onto the next event
          child = null;
        }
      } else {
        // this code is guaranteed not to throw because it is wrapped elsewhere
        handler(active.iteration);
        prevChild = child;
      }

      child = nextChild;
    }
  }

  stream._queueEnd = null;
}

class AsyncIteration {
  constructor(closers) {
    function close() {
      closers.forEach((closer) => {
        closer && closer();
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
    const closers = [];

    let outputStream = new SyncStream();
    let gen = this;
    let parent = gen._parent;

    while (parent) {
      const inputStream = new SyncStream();

      closers.push(gen._open(inputStream, outputStream));

      outputStream = inputStream;
      gen = parent;
      parent = parent._parent;
    }

    // actually start the output stream
    closers.push(gen._open(outputStream, arg));

    return new AsyncIteration(closers);
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
  return makeRootGen((sink) => {
    args.forEach((x) => sink.next(x));
  });
}

function map(mapper) {
  return makeChildGen((source, sink) => {
    subscribe(source, (val) => {
      try {
        sink.next(mapper(val));
      } catch (error) {
        sink.error(error);
      }
    });
  });
}
