// validate({ body, query, params }) with zod schemas. Parsed values replace originals (req.valid.*).
function validate(schemas) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const details = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join('.') || part;
          if (!details[key]) details[key] = issue.message;
        }
        return res.status(400).json({ error: 'Invalid input', details });
      }
      req.valid[part] = result.data;
      if (part === 'body') req.body = result.data; // req.query is read-only in Express 5
    }
    next();
  };
}
module.exports = { validate };
