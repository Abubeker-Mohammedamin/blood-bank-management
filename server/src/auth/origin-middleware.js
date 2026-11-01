function requireExpectedOrigin(clientOrigin) {
  return (request, response, next) => {
    if (request.get('origin') !== clientOrigin) {
      return response.status(403).json({
        error: {
          code: 'INVALID_ORIGIN',
          message: 'The request origin is not allowed.',
        },
      });
    }
    return next();
  };
}

export { requireExpectedOrigin };
