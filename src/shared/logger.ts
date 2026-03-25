import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

const isDev = process.env['NODE_ENV'] !== 'production';

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level}: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    isDev ? combine(colorize(), logFormat) : combine(json()),
  ),
  transports: [new winston.transports.Console()],
});

export function setLogLevel(level: string): void {
  logger.level = level;
}
