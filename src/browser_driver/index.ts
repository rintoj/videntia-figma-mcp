#!/usr/bin/env node
import { main } from "./cli.js";

main(process.argv.slice(2)).then((code) => {
  if (code >= 0) process.exit(code);
});
