import { makeChildGen, makeGen } from "./core.mjs";

console.log("Hi");

let gen = makeGen((output, arg) => {
  console.log("A", arg);

  output.next(1);
  output.next(2);
});

gen = makeChildGen(gen, (output) => (iter) => {
  console.log("B");
});

gen.open(1);
