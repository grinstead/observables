import { openTx, makeTx, makeTxOp, AsyncGen, TxOp, EMPTY } from "./core.mjs";

/**
 * Creates a generator that outputs the given args
 * @template T
 * @param  {...T} args
 * @returns {AsyncGen<T,void>}
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
 * @returns {AsyncGen<T,ReturnT>}
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
 * @returns {AsyncGen<*, T>}
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
 * @param {...AsyncGen<T, *>} els
 * @returns {AsyncGen<T, *>}
 */
export function concat(...els) {
  if (els.length === 0) {
    return EMPTY;
  }

  return makeTx((output) => {
    let nextIndex = 0;
    const openNext = (completedVal) => {
      const index = nextIndex++;
      if (index === els.length) {
        output.complete(completedVal);
      } else {
        openTx(els[index], (source) => {
          output.onClose = () => {
            source.close();
          };
          return ({ done, value }) => {
            if (done === true) {
              openNext(value);
            } else if (done) {
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

/**
 * Runs code when the generator opens
 * @template T
 * @template ReturnT
 * @param {function():AsyncGen<T,ReturnT>} code
 * @returns {AsyncGen<T,ReturnT>}
 */
export function defer(code) {
  return makeTx((output) => {
    openTx(code(), (child) => {
      output.onClose = () => child.close();
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
 * @returns {AsyncGen<T,void>}
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
 * Takes a generator of generators and flattens them into one generator
 * @template T
 * @template ReturnT
 * @returns {TxOp<AsyncGen<T, *>, ReturnT, T, ReturnT>}
 */
export function mergeAll() {
  return makeTxOp((output) => {
    let wrappedReturn = null;
    const children = new Set();

    output.onClose = () => {
      children.forEach((child) => {
        child.close();
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
        openTx(value, (child) => {
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
