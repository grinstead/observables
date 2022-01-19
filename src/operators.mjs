import { runTx, makeTx, makeTxOp, TxGenerator, TxOp, EMPTY } from "./core.mjs";

/**
 * Creates a generator that outputs the given args
 * @template T
 * @param  {...T} args
 * @returns {TxGenerator<T,void>}
 */
export function of(...args) {
  return constants(args);
}

/**
 * Creates a generator that outputs the given elements and ends with the result
 * @template T
 * @template ReturnT
 * @param {Array<T>} constants
 * @param {ReturnT} result
 * @returns {TxGenerator<T,ReturnT>}
 */
export function constants(constants, result) {
  return makeTx((output) => {
    const length = constants.length;
    for (let i = 0; i < length; i++) {
      output.next(constants[i]);
    }
    output.complete(result);
  });
}

/**
 * Creates a generator that synchronously completes with the given value
 * @template T
 * @param {T} returnValue
 * @returns {TxGenerator<*, T>}
 */
export function returns(returnValue) {
  return makeTx((output) => {
    output.complete(returnValue);
  });
}

/**
 * Runs through several generators, subscribing to the next one as the previous one completes.
 * The final return value will become the return value of the result.
 * If no arguments are supplied, it returns EMPTY
 * @template T
 * @param {...TxGenerator<T, *>} els
 * @returns {TxGenerator<T, *>}
 */
export function concat(...els) {
  if (els.length === 0) {
    return EMPTY;
  }

  return makeTx((output) => {
    let nextIndex = 0;

    const runNext = (completedVal) => {
      let runNextSynchronous = true;

      // to avoid deeply nested recursion, we will run all the synchronous
      // elements in this flatter loop
      while (runNextSynchronous) {
        runNextSynchronous = false;

        const index = nextIndex++;
        if (index === els.length) {
          output.complete(completedVal);
        } else {
          runTx(els[index], (source) => {
            output.onClose = () => {
              source.abandon();
            };
            return (iter) => {
              if (iter.done === true) {
                if (!runNextSynchronous) {
                  runNextSynchronous = true;
                } else {
                  runNext(iter.value);
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
 * @template ReturnT
 * @param {function():TxGenerator<T,ReturnT>} code
 * @returns {TxGenerator<T,ReturnT>}
 */
export function defer(code) {
  return makeTx((output) => {
    runTx(code(), (child) => {
      output.onClose = () => child.abandon();
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
 * @returns {TxGenerator<T,void>}
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
 * @template ReturnT
 * @returns {TxOp<Promise<T>|T, ReturnT, T, ReturnT>}
 */
export function resolvePromises() {
  return makeTxOp((output) => {
    // this will be set to null on close
    let promise = Promise.resolve();

    output.onClose = () => {
      promise = null;
    };

    return ({ done, value }) => {
      // pass on errors immediately
      if (done && done !== true) {
        output.error(value);
        return;
      }

      // the promise will be defined at this point, but may not be by the time it resolves
      promise = promise
        .then(() => value)
        .then(
          (resolved) => {
            promise &&
              (done ? output.complete(resolved) : output.next(resolved));
          },
          (error) => {
            promise && output.error(error);
          }
        );
    };
  });
}

/**
 * Maps each value to a new value
 * @template In
 * @template Out
 * @template ReturnT
 * @param {function(In, number):Out} mapper
 * @returns {TxOp<In, ReturnT, Out, ReturnT>}
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
 * @template ReturnT
 * @param {function(T,number):boolean} filterFunc The function, passed both the value and the index
 * @returns {TxOp<T, ReturnT, T, ReturnT>}
 */
export function filter(filterFunc) {
  return makeTxOp((output) => (iter, index) => {
    if (iter.done) {
      output.iter(iter);
    } else {
      const { value } = iter;
      filterFunc(value, index) && output.next(value);
    }
  });
}

/**
 * Takes a generator of generators and flattens them into one generator
 * @template T
 * @template ReturnT
 * @returns {TxOp<TxGenerator<T, *>, ReturnT, T, ReturnT>}
 */
export function mergeAll() {
  return makeTxOp((output) => {
    let wrappedReturn = null;
    const children = new Set();

    output.onClose = () => {
      children.forEach((child) => {
        child.abandon();
      });
    };

    return ({ done, value }) => {
      if (done === true) {
        if (children.size === 0) {
          output.complete(value);
        } else {
          wrappedReturn = [value];
        }
      } else if (done) {
        output.error(value);
      } else {
        runTx(value, (child) => {
          children.add(child);

          return ({ done, value }) => {
            if (done === true) {
              children.delete(child);
              if (wrappedReturn && children.size === 0) {
                output.complete(wrappedReturn[0]);
              }
            } else if (done) {
              children.delete(child);
              wrappedReturn = null;
              output.error(value);
            } else {
              output.next(value);
            }
          };
        });
      }
    };
  });
}
