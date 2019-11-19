import {BaseError, ErrorCodes, isEssentialProjectsError} from '@essential-projects/errors_ts';
import {NextFunction, Request, Response} from 'express';
import {Logger} from 'loggerhythm';

const logger = Logger
  .createLogger('http_extension')
  .createChildLogger('error_handler');

export function errorHandler(error: BaseError | Error, request: Request, response: Response, next: NextFunction): void {

  const isFromEssentialProjects = isEssentialProjectsError(error);

  const statusCode = isFromEssentialProjects
    ? (error as BaseError).code
    : ErrorCodes.InternalServerError;

  const responseMessage = isFromEssentialProjects
    ? JSON.stringify({message: error.message, additionalInformation: (error as BaseError).additionalInformation})
    : error.message;

  logger.info(`${statusCode}`, error);

  response
    .status(statusCode)
    .send(responseMessage);
}
