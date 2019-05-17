import {ErrorCodes, BaseError as EssentialProjectsError, isEssentialProjectsError} from '@essential-projects/errors_ts';
import {NextFunction, Request, Response} from 'express';
import {Logger} from 'loggerhythm';

const logger = Logger
  .createLogger('http_extension')
  .createChildLogger('error_handler');

export function errorHandler(error: Error | EssentialProjectsError, request: Request, response: Response, next: NextFunction): void {

  let responseMessage = '';

  if (error instanceof Error) {
    responseMessage = error.message;
  } else {
    logger.warn('Caught something that is not an instanceof Error:', error);
  }

  const statusCode = isEssentialProjectsError(error)
    ? error.code
    : ErrorCodes.InternalServerError;

  logger.info(`${statusCode}`, error);

  response
    .status(statusCode)
    .send(responseMessage);
}
