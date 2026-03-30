import pc from 'picocolors';

const badge = (name: string, tone: (text: string) => string) => tone(` ${name.toUpperCase().padEnd(4)} `) + ' ';

export const info = (message: string) => badge('info', (text) => pc.black(pc.bgCyan(text))) + message;

export const warn = (message: string) => badge('warn', (text) => pc.black(pc.bgYellow(text))) + message;

export const pending = (message: string) => badge('wait', (text) => pc.black(pc.bgMagenta(text))) + message;

export const success = (message: string) => badge('done', (text) => pc.black(pc.bgGreen(text))) + message;

export const error = (message: string) => badge('fail', (text) => pc.white(pc.bgRed(text))) + message;

export const note = (message: string) => `${pc.dim('       >')} ${pc.dim(message)}`;

export default {info, warn, pending, success, error, note};
