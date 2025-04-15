import winston from "winston";

const customFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `[${level}]: ${timestamp} ${message}`;
});

const level = process.env.LOG_LEVEL?.trim() || (process.env.NODE_ENV === "production" ? "info" : "debug");
const logger = winston.createLogger({
    level: level,
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
            format: "YYYY-MM-DD HH:mm:ss.SSS",
        }),
        customFormat,
    ),
    transports: [new winston.transports.Console()],
    silent: false,
});

export default logger;
