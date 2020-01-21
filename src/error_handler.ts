import {BaseError, ErrorCodes, isEssentialProjectsError} from '@essential-projects/errors_ts';
import {NextFunction, Request, Response} from 'express';
import {Logger} from 'loggerhythm';

const logger = Logger
  .createLogger('http_extension')
  .createChildLogger('error_handler');

// NOTE: The function signature must be exact, or express will not recognize it as an error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: BaseError | Error, request: Request, response: Response, next: NextFunction): void {

  const isFromEssentialProjects = isEssentialProjectsError(error);

  const statusCode = isFromEssentialProjects
    ? (error as BaseError).code
    : ErrorCodes.InternalServerError;

  let responseMessage;
  if (isFromEssentialProjects) {
    responseMessage = JSON.stringify({message: error.message, additionalInformation: (error as BaseError).additionalInformation});
  } else {
    const expectJsonAsResponse = request.headers['content-type'] === 'application/json';

    responseMessage = expectJsonAsResponse ? JSON.stringify({message: error.message}) : error.message;
  }

  logger.info(`${statusCode}`, error);

  response
    .status(statusCode)
    .send(responseMessage);
}
