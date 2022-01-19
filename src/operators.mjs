import { openTx, makeTx, makeTxOp, AsyncGen } from "./core.mjs";

export function of(...args) {
  return makeTx((output) => {
    args.forEach((arg) => {
      output.next(arg);
    });
  });
}

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
