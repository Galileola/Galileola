// CommonJS entry for Hostinger's Node.js runner (LiteSpeed lsnode), which loads the entry
// file with require(). src/start.js is an ES module with top-level await, so load it via import().
import('./src/start.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
