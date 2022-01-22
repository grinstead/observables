export function test(name, code) {
  let goodBelow = 0;
  let error = null;
  const got = (input) => {
    let localError = null;
    if (typeof input === "string") {
      localError = new Error(input);
    } else if (input === false) {
      localError = new Error(`got false`);
    } else if (input === true || input === (input | 0)) {
      const num = input === true ? goodBelow : input;

      if (num < 0) {
        localError = new Error(`Got ${input}`);
      } else if (num > goodBelow) {
        localError = new Error(`Got ${num} before ${goodBelow}`);
      } else if (num < goodBelow) {
        localError = new Error(`Got ${num} twice`);
      } else {
        goodBelow++;
      }
    } else {
      localError = new Error(`Bad input to got: ${input}`);
    }

    if (localError) {
      error ||= localError;
      throw localError;
    }
  };

  got.endsWith = (endWith) => ({
    next: got,
    complete: () => got(endWith),
  });

  const expect = (total) => {
    if (error) {
      throw error;
    }

    if (total > goodBelow) {
      throw new Error(`Missing ${goodBelow}`);
    } else if (total < goodBelow) {
      throw new Error(`Received ${goodBelow - total + 1} excess values`);
    }

    // reset for the next test
    goodBelow = 0;
  };

  return Deno.test(name, () => code(got, expect));
}
