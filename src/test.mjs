import { makeChildGen, makeGen } from "./core.mjs";

console.log("Hi");

let gen = makeGen((output) => {
  console.log("A1");
  output.next(1);
  console.log("A2");
  output.next(2);
});

gen = makeChildGen(gen, (output) => (iter) => {
  console.log("B");
});

gen.open(1);
