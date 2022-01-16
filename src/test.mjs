import { makeTxOp, makeTx } from "./core.mjs";

console.log("Hi");

let gen = makeTx((output) => {
  let running = true;
  output.close = () => {
    console.log("A closed");
    running = false;
  };

  [1, 2, 3, 4].every((x) => {
    console.log(`A${x}`);
    output.next(x);
    return true; //running;
  });

  output.complete();
});

gen = makeTxOp((output, unsubscribe) => (iter, index) => {
  console.log("B", iter);
  output.iter(iter);
  if (index === 2) {
    // unsubscribe();
    throw "FAIL";
  }
  output.com;
})(gen);

gen = makeTxOp((_, unsubscribe) => (iter) => {
  console.log("C", iter);
})(gen);

gen.open();
