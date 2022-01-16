import { makeChildGen, makeGen } from "./core.mjs";

console.log("Hi");

let gen = makeGen((output) => {
  console.log("A1");
  output.next(1);
  console.log("A2");
  output.next(2);
  output.return(5);
});

gen = makeChildGen(gen, (output) => (iter) => {
  console.log("B", iter);
});

gen.open();
