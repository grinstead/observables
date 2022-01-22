import { runTx, makeTx, makeTxOp, TxGenerator, TxOp, EMPTY } from "./core.mjs";

/**
 * Creates a generator that outputs the given args
 * @template T
 * @param  {...T} args
 * @returns {TxGenerator<T>}
 */
export function of(...args) {
  return from(args);
}

/**
 * Creates a generator that outputs the given elements and ends with the result
 * @template T
 * @param {Array<T>} constants
 * @returns {TxGenerator<T>}
 */
export function from(constants) {
  return makeTx((output) => {
    const length = constants.length;
    for (let i = 0; i < length; i++) {
      output.next(constants[i]);
    }
    output.complete();
  });
}

/**
 * Runs through several generators, subscribing to the next one as the previous one completes.
 * The final return value will become the return value of the result.
 * If no arguments are supplied, it returns EMPTY
 * @template T
 * @param {...TxGenerator<T>} els
 * @returns {TxGenerator<T>}
 */
export function concat(...els) {
  if (els.length === 0) {
    return EMPTY;
  }

  return makeTx((output) => {
    let nextIndex = 0;

    const runNext = () => {
      let runNextSynchronous = true;

      // to avoid deeply nested recursion, we will run all the synchronous
      // elements in this flatter loop
      while (runNextSynchronous) {
        runNextSynchronous = false;

        const index = nextIndex++;
        if (index === els.length) {
          output.complete();
        } else {
          runTx(els[index], (source) => {
            output.onClose = () => {
              source.abandon();
            };

            return (iter) => {
              if (iter.done && !iter.value) {
                if (!runNextSynchronous) {
                  runNextSynchronous = true;
                } else {
                  runNext();
                }
              } else {
                output.iter(iter);
              }
            };
          });
        }
      }

      // tell the child it can run itself
      runNextSynchronous = true;
    };

    runNext();
  });
}

/**
 * Runs code when the generator opens
 * @template T
 * @param {function():TxGenerator<T>} code
 * @returns {TxGenerator<T>}
 */
export function defer(code) {
  return makeTx((output) => {
    runTx(code(), (child) => {
      output.onClose = () => {
        child.abandon();
      };

      return (iter) => {
        output.iter(iter);
      };
    });
  });
}

/**
 * Returns a timer that fires a value after the given time
 * @template T
 * @param {number} timeMs
 * @param {T} arg
 * @returns {TxGenerator<T>}
 */
export function timer(timeMs, arg) {
  return makeTx((output) => {
    const timeoutId = setTimeout(() => {
      output.onClose = null;
      output.next(arg);
      output.complete();
    }, timeMs);

    output.onClose = () => {
      clearTimeout(timeoutId);
    };
  });
}

/**
 * Takes the input values and waits for the promises to resolve. Note that this
 * will always bump values to a promise tick.
 * @template T
 * @returns {TxOp<Promise<T>|T, T>}
 */
export function resolvePromises() {
  return makeTxOp((output) => {
    // this will be set to null on close
    let promise = Promise.resolve();

    output.onClose = () => {
      promise = null;
    };

    return (iter) => {
      if (iter.done) {
        if (iter.value) {
          // pass on errors immediately
          output.iter(iter);
        } else {
          // wait until the previous promises finish before completing
          promise = promise.then(() => {
            promise && output.iter(iter);
          });
        }
      } else {
        // the promise will be defined at this point, but may not be by the time it resolves
        promise = promise
          .then(() => iter.value)
          .then(
            (resolved) => {
              promise && output.next(resolved);
            },
            (error) => {
              promise && output.error(error);
            }
          );
      }
    };
  });
}

/**
 * Maps each value to a new value
 * @template In
 * @template Out
 * @param {function(In, number):Out} mapper
 * @returns {TxOp<In, Out>}
 */
export function map(mapper) {
  return makeTxOp((output) => (iter, index) => {
    if (iter.done) {
      output.iter(iter);
    } else {
      output.next(mapper(iter.value, index));
    }
  });
}

/**
 * Filters out the values that return falsy
 * @template T
 * @param {function(T,number):boolean} filterFunc The function, passed both the value and the index
 * @returns {TxOp<T, T>}
 */
export function filter(filterFunc) {
  return makeTxOp((output) => (iter, index) => {
    (iter.done || filterFunc(iter.value, index)) && output.iter(iter);
  });
}

/**
 * Takes a generator of generators and flattens them into one generator
 * @template T
 * @returns {TxOp<TxGenerator<T>, T>}
 */
export function mergeAll() {
  return makeTxOp((output) => {
    let outerCompleted = false;
    const children = new Set();

    output.onClose = () => {
      children.forEach((child) => {
        child.abandon();
      });
    };

    return (outerIter) => {
      if (outerIter.done) {
        if (outerIter.value || !children.size) {
          // it is an error or there are no children running, in either case we
          // are done.
          output.iter(outerIter);
        } else {
          // tells the children to call complete when they all finish
          outerCompleted = true;
        }
      } else {
        runTx(outerIter.value, (child) => {
          children.add(child);

          return (iter) => {
            if (iter.done) {
              children.delete(child);
              if (iter.value || (outerCompleted && !children.size)) {
                // either this was an error, or there are no other children
                // running. In either case, we need to send the message
                outerCompleted = false;
                output.iter(iter);
              }
            } else {
              // normal case
              output.iter(iter);
            }
          };
        });
      }
    };
  });
}
