import { faker } from "@faker-js/faker";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { lookup } from "mime-types";
import WebSocket from "ws";
import * as uWS from "uWebSockets.js";
import { ServerResponse } from 'http';
import { Response } from "express";
import logger from "./logger";
import os from "os";
import { FastifyReply } from "fastify";

export const PORT = process.env.PORT || 3000;
export const CHUNK_SIZE = 100 * 1024; // 100KB chunk

faker.seed(500); // a fixed seed minimizes random data variation between test runs for each server

export interface CoValue {
    uuid: string;
    lastUpdated: Date;
    author: string;
    title: string;
    summary: string;
    preview: string;
    url?: File;
    file?: File;
}

export interface File {
    name: string;
    path?: string;
    data?: string;
}

export interface MutationEvent {
    type: "text" | "binary";
    field?: string;
    value?: string;
}

export function createRandomCoValue() {
    return {
        uuid: faker.string.uuid(),
        lastUpdated: faker.date.past(),
        author: faker.person.fullName(),
        title: faker.lorem.words({ min: 3, max: 5 }),
        summary: faker.lorem.sentence(),
        preview: faker.lorem.lines({ min: 100, max: 100 }), // 100 lines ~= 5KB of text
        url: { name: "sample.zip", path: "public/downloads/sample.zip" },
    };
}

const _covalues: CoValue[] = faker.helpers.multiple(createRandomCoValue, {
    count: 100,
});

export const covalues: Record<string, CoValue> = _covalues.reduce(
    (acc, covalue) => {
        acc[covalue.uuid] = covalue;
        return acc;
    },
    {} as Record<string, CoValue>,
);

export const firstCoValue = (() => {
    const keys = Object.keys(covalues);
    const index = 0;
    return {
        uuid: keys[index],
        index: index + 1
    };
})();

export const events = new Map<string, MutationEvent>();

export interface UserData {
    uuid?: string;
    ua?: string;
    streams?: Record<string, fs.ReadStream>;
}

export function addCoValue(
    covalues: Record<string, CoValue>,
    covalue: CoValue,
): void {
    let uuid;
    const newCoValue: CoValue = { ...covalue };
    if (newCoValue.uuid) {
        uuid = newCoValue.uuid;
    } else {
        uuid = uuidv4();
        newCoValue.uuid = uuid;
    }
    newCoValue.lastUpdated = new Date();
    covalues[uuid] = newCoValue;
}

function _updateCoValue(covalue: CoValue, event?: MutationEvent): void {
    covalue.lastUpdated = new Date();

    if (event) {
        logger.debug(
            `Adding a mutation event of type '${event.type}' for: ${covalue.uuid}.`,
        );
        events.set(covalue.uuid, event);
    } else {
        logger.warn(
            `No VALID mutation event was present in the request for: ${covalue.uuid}.`,
        );
    }
}

export function updateCoValue(
    covalue: CoValue,
    partialCovalue: Partial<CoValue>,
): void {
    let event: MutationEvent | undefined = undefined;

    // Only update fields present in the request body
    if (partialCovalue.author) {
        covalue.author = partialCovalue.author;
        event = { type: "text", field: "author", value: covalue.author };
    }
    if (partialCovalue.title) {
        covalue.title = partialCovalue.title;
        event = { type: "text", field: "title", value: covalue.title };
    }
    if (partialCovalue.summary) {
        covalue.summary = partialCovalue.summary;
        event = { type: "text", field: "summary", value: covalue.summary };
    }
    if (partialCovalue.preview) {
        covalue.preview = partialCovalue.preview;
        event = { type: "text", field: "preview", value: covalue.preview };
    }

    _updateCoValue(covalue, event);
}

export function updateCoValueBinary(
    covalue: CoValue,
    partialCovalue: Partial<CoValue>,
): void {
    let event: MutationEvent | undefined = undefined;

    if (partialCovalue.file) {
        covalue.file = partialCovalue.file;

        // if (covalue.file.name) {
        //   event = {
        //     type: "binary",
        //     field: "file.name",
        //     value: covalue.file.name,
        //   };
        // }
        if (covalue.file.data) {
            event = {
                type: "binary",
                field: "file.data",
                value: covalue.file.data,
            };
        }
    }

    _updateCoValue(covalue, event);
}

export function formatClientNumber(object:any, width: number = 2) {
    if (!object) {
        return "00";
    }

    if (object && object.ua) {
        if (object.ua.length == width) {
            return object.ua;
        } else if (object.ua.length < width) {
            return `0${object.ua}`;
        }
    } else {
        return "00";
    }
}

/**
 * Parses out the UUID and UA (User Agent) from a cookie, if present
 * @param req the request object
 * @returns UserData
 */
export function parseUUIDAndUAFromCookie(req: any) {
    const cookieHeader = req.getHeader('cookie');

    if (!cookieHeader) {
        return { uuid: null, ua: null };
    }

    const uuidMatch = cookieHeader.match(/uuid=([^;]+)/);
    const uaMatch = cookieHeader.match(/ua=([^;]+)/);

    return {
        uuid: uuidMatch ? uuidMatch[1] : null,
        ua: uaMatch ? uaMatch[1] : null
    };
}

// BufferLike partial copy from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/ac8b76bf4ccc707b38e8b2ec8b0a3cb42bd83bf5/types/ws/index.d.ts#L20
type BufferLike =
    | string
    | Buffer
    | DataView
    | number
    | ArrayBufferView
    | Uint8Array
    | ArrayBuffer
    | SharedArrayBuffer;

/**
 * Abstract base class for WebSocket responses, parameterized by the WebSocket implementation.
 */
export abstract class WebSocketResponseBase<TWebSocket> {
    protected ws: TWebSocket;
    protected actionName: string = "";
    protected statusCode: number = 200;
    protected timer: RequestTimer;

    constructor(ws: TWebSocket, requestId?: string) {
        this.ws = ws;
        this.timer = new RequestTimer(requestId ?? "ua-00");
    }

    action(action: string): this {
        this.actionName = action;
        this.timer.method(action);
        return this;
    }

    status(code: number): this {
        this.statusCode = code;
        this.timer.status(code);
        return this;
    }

    path(path: string): this {
        this.timer.path(path);
        return this;
    }

    json(data: object, callback?: (error?: Error) => void): void {
        try {
            this.send(
                JSON.stringify({
                    action: this.actionName,
                    code: this.statusCode,
                    payload: data,
                }),
                callback
            );
            this.timer.end();
            // callback?.();
        } catch (error) {
            this.timer.end();
            // callback?.(error as Error);
        }
    }

    requestLog(): RequestLog {
        return this.timer.toRequestLog();
    }

    /**
     * Returns the WebSocket instance.
     * @returns The WebSocket instance.
     */
      getWS(): TWebSocket {
        return this.ws;
    }

    /**
     * Abstract method for sending data to the WebSocket.
     * @param data The data to send.
     * @param callback Optional callback for error handling.
     */
    abstract send(data: BufferLike, callback?: (err?: Error) => void): void;

    /**
     * Abstract method for broadcasting data to other clients.
     * @param data The data to broadcast.
     */
    abstract broadcast(data: object): void;
}

/**
 * Implementation for WebSocket using the `ws` library.
 */
export class WebSocketResponse extends WebSocketResponseBase<WebSocket> {
    private wss: WebSocket.Server;

    constructor(ws: WebSocket, wss: WebSocket.Server, requestId?: string) {
        super(ws, requestId);
        this.wss = wss;
    }

    send(data: BufferLike, cb?: (err?: Error) => void): void {
        this.ws.send(data, cb);
    }

    broadcast(data: object): void {
        this.wss.clients.forEach((client) => {
            if (client !== this.ws && client.readyState === WebSocket.OPEN) {
                client.send(
                    JSON.stringify({
                        action: this.actionName,
                        code: this.statusCode,
                        payload: data,
                    })
                );
            }
        });
        this.timer.end();
    }
}

/**
 * WebSocket send statuses for `uWebSockets.js`
 * See https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocket.html#send
 */
enum uSendStatus {
    BACKPRESSURE = 0,
    SUCCESS = 1,
    DROPPED = 2
};

/**
 * Implementation for WebSocket using `uWebSockets.js`.
 */
export class uWebSocketResponse extends WebSocketResponseBase<uWS.WebSocket<{}>> {
    private topic: string;

    constructor(ws: uWS.WebSocket<{}>, topic: string, requestId?: string) {
        super(ws, requestId);
        this.topic = topic;
    }

    send(data: any, callback?: (error?: Error) => void): void {
        try {
            let status;
            if (typeof data !== "string") {
                status = this.ws.send(data, true);
            } else {
                status = this.ws.send(data);
            }

            switch (status) {
                case uSendStatus.BACKPRESSURE:
                    // logger.warn(`Status: ${status} (uSendStatus.BACKPRESSURE)`);
                    callback?.(new Error("Backpressure"));
                    break;

                case uSendStatus.SUCCESS:
                    callback?.();
                    break;

                case uSendStatus.DROPPED:
                    // logger.warn(`Status: ${status} (uSendStatus.DROPPED)`);
                    callback?.(new Error("Dropped"));
                    break;
            }
            // callback?.();
        } catch (error) {
            callback?.(error as Error);
        }
    }

    broadcast(data: object): void {
        this.ws.publish(
            this.topic,
            JSON.stringify({
                action: this.actionName,
                code: this.statusCode,
                payload: data,
            }),
            false
        );
        this.timer.end();
    }
}

interface RequestLog {
    requestId: string;
    duration: number;
    durationInMillis?: string;
    method?: string;
    path?: string;
    status?: number;
    timestamp?: string;
}

export class RequestTimer {
    private startTime: number;
    private data: RequestLog;

    constructor(requestId: string) {
        this.startTime = performance.now();
        this.data = { requestId, duration: -1, timestamp: new Date().toISOString() };
    }

    method(method: string): this {
        this.data.method = method;
        return this;
    }

    path(path: string): this {
        this.data.path = path;
        return this;
    }

    status(status: number): this {
        this.data.status = status;
        return this;
    }

    end(): this {
        this.data.duration = performance.now() - this.startTime;
        this.data.durationInMillis = this.data.duration.toFixed(2);
        logger.debug(`Performance entry: ${JSON.stringify(this.toRequestLog())}`);
        return this;
    }

    toRequestLog(): RequestLog {
        return this.data;
    }
}

export class BenchmarkStore {
    private entries: RequestLog[] = [];
    private requestCounter: number = 0;

    requestId(): string {
        return `${++this.requestCounter}`;
    }

    addRequestLog(entry: RequestLog): void {
        this.entries.push(entry);
    }

    aggregateRequestLogs(): void {
        interface Accumulator {
            remaining: RequestLog[];
            aggregate: number;
        }

        const result = this.entries.reduce<Accumulator>((acc, entry) => {
            // aggregate the total duration of streaming multiple chunks during a binary CoValue upload
            if (entry.method === "POST" && entry.path === "/covalue/binary") {
                return entry.status === 200
                    ? { remaining: acc.remaining, aggregate: acc.aggregate + entry.duration }
                    : entry.status === 201
                        ? { remaining: [...acc.remaining, { ...entry, duration: entry.duration + acc.aggregate, durationInMillis: (entry.duration + acc.aggregate).toFixed(2) }], aggregate: 0 }
                        : { remaining: [...acc.remaining, entry], aggregate: acc.aggregate };
            }
            return { remaining: [...acc.remaining, entry], aggregate: acc.aggregate };
        }, { remaining: [], aggregate: 0 });

        this.entries = result.remaining;
    }

    exportToCSVFile(filename: string = 'time.csv'): void {
        filename = process.env.EXPORT_FILENAME ?? filename;
        const outputPath = `${filename}`;
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        // sum up the duration of multiple chunked POST requests into a single duration
        this.aggregateRequestLogs();

        // Write performance data to CSV
        const csvHeaders = 'RequestID,Method,Path,StatusCode,Timestamp,Duration (milliseconds)';
        const csvContent = this.entries
        .map(entry => `${entry.requestId},${entry.method},${entry.path},${entry.status},${entry.timestamp},${entry.durationInMillis}`)
        .join(os.EOL);

        if (!fs.existsSync(outputPath)) {
            fs.writeFileSync(outputPath, csvHeaders + os.EOL + csvContent + os.EOL);
        } else {
            fs.appendFileSync(outputPath, csvContent + os.EOL);
        }
        logger.info(`Performance log (${this.entries.length} records) written to CSV: ${outputPath}`);

        // Clear the store after writing to disk
        this.entries = [];
    }
}

export class FastifyResponseWrapper {
    constructor(protected res: FastifyReply) {}

    status(code: number): this {
        this.res.statusCode = code;
        return this;
    }

    json(data: any): void {
        this.res.header('Content-Type', 'application/json');
        this.res.send(JSON.stringify(data));
    }
}

export class WebSocketResponseWrapper {
    constructor(protected res: ServerResponse) {}

    status(code: number): this {
        this.res.statusCode = code;
        return this;
    }

    json(data: any): void {
        this.res.setHeader('Content-Type', 'application/json');
        this.res.end(JSON.stringify(data));
    }
}

export class uWebSocketResponseWrapper {
    constructor(protected res: uWS.HttpResponse) {}

    status(code: number): this {
        this.res.statusCode = code;
        return this;
    }

    json(data: any): void {
        this.res.writeStatus(this.res.statusCode.toString());
        this.res.writeHeader('Content-Type', 'application/json');
        this.res.end(JSON.stringify(data));
    }
}

export function shutdown(res: Response | FastifyResponseWrapper | WebSocketResponseWrapper | uWebSocketResponseWrapper, benchmarkStore: BenchmarkStore, exportFileName: string, callback?: () => void) {
    benchmarkStore.exportToCSVFile(exportFileName);
    res.status(200).json({ m: `Performance data written to CSV. Server shutting down.` });

    callback?.();

    logger.info("Server shutdown");
    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

export const handleStaticRoutes = (
    res: uWS.HttpResponse,
    req: uWS.HttpRequest,
    staticDir: string,
    benchmarkStore: BenchmarkStore,
    clientType = "ws", // or "http"
    exportFileName: string
) => {
    const url = req.getUrl();
    const prefix = "/faker";

    try {
        if (url === "/") {
            const filePath = path.join(staticDir, "client", clientType, "index.html");
            const fileContents = fs.readFileSync(filePath);

            res.writeHeader('Content-Type', 'text/html')
               .end(fileContents);

        } else if (url.startsWith(prefix)) {
            const file = url.substring(prefix.length, url.length);
            const filePath = path.join(
                __dirname,
                `../../node_modules/@faker-js/faker/dist/esm/${file}`,
            );

            const fileContents = fs.readFileSync(filePath);
            const fileStat = fs.statSync(filePath);

            res.writeHeader("Content-Length", `${fileStat.size}`);
            res.writeHeader("Content-Type", lookup(filePath) || "application/octet-stream");
            res.end(fileContents);
        } else if (url.startsWith("/stop")) {
            shutdown(new uWebSocketResponseWrapper(res), benchmarkStore, exportFileName);
        } else {
            res.writeStatus('404').end('Not found');
        }
    } catch (error) {
        logger.debug(`URL 404ing: ${url}`);
        logger.error(error);
        res.writeStatus('404').end('File not found');
    }
};