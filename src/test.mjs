import { makeTxOp, makeTx } from "./core.mjs";

console.log("Hi");

let gen = makeTx((output) => {
  let running = true;
  output.close = () => {
    console.log("A closed");
    running = false;
  };

  [0, 1, 2, 3, 4].every((x) => {
    console.log(`A${x}`);
    output.next(x);
    return running;
  });

  output.complete();
});

gen = makeTxOp((output) => (iter, index) => {
  console.log("B", iter);
  output.iter(iter);
  if (index === 2) {
    output.close();
    // throw "FAIL";
  }
})(gen);

gen = makeTxOp((output) => (iter) => {
  console.log("C", iter);
})(gen);

gen.open();
