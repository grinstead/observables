import { openTx, makeTx, makeTxOp } from "./core.mjs";

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
    let running = new Set();

    output.onClose = () => {
      const all = running;
      running = null; // so they do not delete themselves
      all.forEach((subtx) => {
        subtx.close();
      });
    };

    return ({ done, value }) => {
      if (done === true) {
        if (running.size === 0) {
          output.complete(value);
        } else {
          wrappedReturn = [value];
        }
      } else if (done) {
        output.error(value);
      } else {
        openTx(value, (child) => {
          running.add(child);

          child.onClose = () => {
            if (running) {
              running.delete(child);
              if (wrappedReturn && running.size === 0) {
                output.complete(wrappedReturn[0]);
              }
            }
          };

          return ({ done, value }) => {
            if (!done) {
              output.next(value);
            } else if (done !== true) {
              wrappedReturn = null;
              output.error(value);
            }
          };
        });
      }
    };
  });
}
