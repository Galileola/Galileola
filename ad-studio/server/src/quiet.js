// Node's built-in SQLite prints an "experimental" warning at start-up.
// It is harmless; this hides it without hiding other warnings. Imported first.
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning' || warning?.name === 'ExperimentalWarning') return;
  return emit.call(process, warning, ...rest);
};
