export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status === 500) {
    console.error('Unhandled error:', err);
  }
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
}
