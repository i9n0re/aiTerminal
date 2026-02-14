import { bind } from 'decko';
import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { OverlayAddon } from './addons/overlay';
import { ZmodemAddon } from './addons/zmodem';

import '@xterm/xterm/css/xterm.css';

interface TtydTerminal extends Terminal {
    fit(): void;
}

declare global {
    interface Window {
        term: TtydTerminal;
    }
}

enum Command {
    OUTPUT = '0',
    SET_WINDOW_TITLE = '1',
    SET_PREFERENCES = '2',
    INPUT = '0',
    RESIZE_TERMINAL = '1',
    PAUSE = '2',
    RESUME = '3',
}
type Preferences = ITerminalOptions & ClientOptions;
export type RendererType = 'dom' | 'canvas' | 'webgl';

export interface ClientOptions {
    rendererType: RendererType;
    disableLeaveAlert: boolean;
    disableResizeOverlay: boolean;
    enableZmodem: boolean;
    enableTrzsz: boolean;
    enableSixel: boolean;
    titleFixed?: string;
    isWindows: boolean;
    trzszDragInitTimeout: number;
    unicodeVersion: string;
    closeOnDisconnect: boolean;
}

export interface FlowControl {
    limit: number;
    highWater: number;
    lowWater: number;
}

export interface XtermOptions {
    wsUrl: string;
    tokenUrl: string;
    flowControl: FlowControl;
    clientOptions: ClientOptions;
    termOptions: ITerminalOptions;
}

function toDisposable(f: () => void): IDisposable {
    return { dispose: f };
}

function addEventListener(target: EventTarget, type: string, listener: EventListener): IDisposable {
    target.addEventListener(type, listener);
    return toDisposable(() => target.removeEventListener(type, listener));
}

export class Xterm {
    private disposables: IDisposable[] = [];
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();
    private written = 0;
    private pending = 0;

    private terminal: Terminal;
    private fitAddon = new FitAddon();
    private overlayAddon = new OverlayAddon();
    private clipboardAddon = new ClipboardAddon();
    private webLinksAddon = new WebLinksAddon();
    private webglAddon?: WebglAddon;
    private canvasAddon?: CanvasAddon;
    private zmodemAddon?: ZmodemAddon;

    private socket?: WebSocket;
    private token: string;
    private opened = false;
    private title?: string;
    private titleFixed?: string;
    private resizeOverlay = true;
    private reconnect = true;
    private doReconnect = true;
    private closeOnDisconnect = false;
    private serverDataCb: ((data: string) => boolean) | undefined;
    private webMouseMode = false;

    private writeFunc = (data: ArrayBuffer) => this.writeData(new Uint8Array(data));

    constructor(private options: XtermOptions, private sendCb: () => void) {}

    public onServerData(callback: (data: string) => boolean) {
        this.serverDataCb = callback;
    }

    public setWebMouseMode(enabled: boolean) {
        this.webMouseMode = enabled;
        if (enabled) {
            // 物理重置终端的鼠标模式：发送关闭 X10, VT200, SGR 鼠标报告的转义序列
            this.terminal.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l');
            console.log('[ttyd] Native mouse protocols disabled for web selection');
        } else {
            // 核心修复：手动向 xterm.js 注入开启序列，强制其重新捕获鼠标
            // 同时发送刷新指令，让后端配合 tmux 重新同步状态
            this.terminal.write('\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h');
            this.sendCommand('4');
            console.log('[ttyd] Native mouse protocols re-enabled');
        }
    }

    dispose() {
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }

    @bind
    private register<T extends IDisposable>(d: T): T {
        this.disposables.push(d);
        return d;
    }

    @bind public onTitleChange(callback: (title: string) => void): IDisposable {
        return this.terminal.onTitleChange(callback);
    }

    @bind public sendFile(files: FileList) {
        this.zmodemAddon?.sendFile(files);
    }

    @bind
    public async refreshToken() {
        try {
            const resp = await fetch(this.options.tokenUrl);
            if (resp.ok) {
                const json = await resp.json();
                this.token = json.token;
            }
        } catch (e) {
            console.error(`[ttyd] fetch ${this.options.tokenUrl}: `, e);
        }
    }

    @bind
    private onWindowUnload(event: BeforeUnloadEvent) {
        event.preventDefault();
        if (this.socket?.readyState === WebSocket.OPEN) {
            const message = 'Close terminal? this will also terminate the command.';
            event.returnValue = message;
            return message;
        }
        return undefined;
    }

    private copyToClipboard(text: string) {
        if (!text) return;
        const fallbackCopy = () => {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                if (document.execCommand('copy')) this.overlayAddon?.showOverlay('\u2702', 200);
            } catch (err) { console.error('[ttyd] Fallback copy failed', err); }
            document.body.removeChild(textArea);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.overlayAddon?.showOverlay('\u2702', 200);
            }).catch(() => fallbackCopy());
        } else { fallbackCopy(); }
    }

    @bind
    public open(parent: HTMLElement) {
        this.terminal = new Terminal(this.options.termOptions);
        const { terminal, fitAddon, overlayAddon, clipboardAddon, webLinksAddon } = this;
        window.term = terminal as TtydTerminal;
        window.term.fit = () => { this.fitAddon.fit(); };
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(overlayAddon);
        terminal.loadAddon(clipboardAddon);
        terminal.loadAddon(webLinksAddon);
        terminal.open(parent);
        fitAddon.fit();
        const el = terminal.element;
        if (el) {
            this.register(addEventListener(el, 'mouseup', () => {
                setTimeout(() => {
                    const selection = terminal.getSelection();
                    if (selection) this.copyToClipboard(selection);
                }, 10);
            }));
        }
    }

    @bind
    private initListeners() {
        const { terminal, fitAddon, overlayAddon, register, sendData } = this;
        register(terminal.onTitleChange(data => {
            if (data && data !== '' && !this.titleFixed) document.title = data + ' | ' + this.title;
        }));
        register(terminal.onData(data => {
            // 在 Web Selection 开启时，拦截所有尝试发往后端的鼠标信号
            if (this.webMouseMode) {
                if (data.startsWith('\x1b[M') || data.startsWith('\x1b[<')) return;
            }
            sendData(data);
        }));
        register(terminal.onBinary(data => sendData(Uint8Array.from(data, v => v.charCodeAt(0)))));
        register(terminal.onResize(({ cols, rows }) => {
            const msg = JSON.stringify({ columns: cols, rows: rows });
            this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
            if (this.resizeOverlay) overlayAddon.showOverlay(`${cols}x${rows}`, 300);
        }));
        register(addEventListener(window, 'resize', () => fitAddon.fit()));
        register(addEventListener(window, 'beforeunload', this.onWindowUnload));
    }

    @bind
    public writeData(data: string | Uint8Array) {
        const { terminal } = this;
        const { limit, highWater, lowWater } = this.options.flowControl;
        this.written += data.length;
        if (this.written > limit) {
            terminal.write(data, () => {
                this.pending = Math.max(this.pending - 1, 0);
                if (this.pending < lowWater) this.socket?.send(this.textEncoder.encode(Command.RESUME));
            });
            this.pending++;
            this.written = 0;
            if (this.pending > highWater) this.socket?.send(this.textEncoder.encode(Command.PAUSE));
        } else {
            terminal.write(data);
        }
    }

    @bind
    public sendData(data: string | Uint8Array) {
        const { socket, textEncoder } = this;
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (typeof data === 'string') {
            const payload = new Uint8Array(data.length * 3 + 1);
            payload[0] = Command.INPUT.charCodeAt(0);
            const stats = textEncoder.encodeInto(data, payload.subarray(1));
            socket.send(payload.subarray(0, (stats.written as number) + 1));
        } else {
            const payload = new Uint8Array(data.length + 1);
            payload[0] = Command.INPUT.charCodeAt(0);
            payload.set(data, 1);
            socket.send(payload);
        }
    }

    @bind
    public sendCommand(cmd: string, data?: string) {
        const { socket, textEncoder } = this;
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (data) {
            const payload = new Uint8Array(data.length + 1);
            payload[0] = cmd.charCodeAt(0);
            textEncoder.encodeInto(data, payload.subarray(1));
            socket.send(payload);
        } else {
            const payload = new Uint8Array(1);
            payload[0] = cmd.charCodeAt(0);
            socket.send(payload);
        }
    }

    @bind
    public connect() {
        this.socket = new WebSocket(this.options.wsUrl, ['tty']);
        this.socket.binaryType = 'arraybuffer';
        this.register(addEventListener(this.socket, 'open', this.onSocketOpen));
        this.register(addEventListener(this.socket, 'message', this.onSocketData as EventListener));
        this.register(addEventListener(this.socket, 'close', this.onSocketClose as EventListener));
        this.register(addEventListener(this.socket, 'error', e => console.error('[ttyd] socket error:', e)));
    }

    @bind
    private onSocketOpen() {
        setTimeout(() => {
            const { textEncoder, terminal } = this;
            const msg = JSON.stringify({ AuthToken: this.token, columns: Math.max(terminal.cols, 1), rows: Math.max(terminal.rows, 1) });
            this.socket?.send(textEncoder.encode(msg));
            if (this.opened) {
                terminal.reset();
                terminal.options.disableStdin = false;
            } else { this.opened = true; }
            this.doReconnect = this.reconnect;
            this.initListeners();
            terminal.focus();
        }, 100);
    }

    @bind
    private onSocketClose(event: CloseEvent) {
        const { refreshToken, connect, doReconnect, overlayAddon } = this;
        overlayAddon.showOverlay('Connection Closed');
        this.dispose();
        if (event.code !== 1000 && doReconnect) { refreshToken().then(connect); }
        else if (this.closeOnDisconnect) { window.close(); }
        else {
            const keyDispose = this.terminal.onKey(e => {
                if (e.domEvent.key === 'Enter') { keyDispose.dispose(); refreshToken().then(connect); }
            });
            overlayAddon.showOverlay('Press ⏎ to Reconnect');
        }
    }

    @bind
    private parseOptsFromUrlQuery(query: string): Preferences {
        const prefs = {} as Preferences;
        const queryObj = Array.from(new URLSearchParams(query) as unknown as Iterable<[string, string]>);
        for (const [k, queryVal] of queryObj) {
            let v = this.options.clientOptions[k];
            if (v === undefined) v = this.terminal.options[k];
            switch (typeof v) {
                case 'boolean': prefs[k] = queryVal === 'true' || queryVal === '1'; break;
                case 'number': case 'bigint': prefs[k] = Number.parseInt(queryVal, 10); break;
                case 'string': prefs[k] = queryVal; break;
                case 'object': prefs[k] = JSON.parse(queryVal); break;
                default: prefs[k] = queryVal; break;
            }
        }
        return prefs;
    }

    @bind
    private onSocketData(event: MessageEvent) {
        const rawData = event.data as ArrayBuffer;
        const cmd = String.fromCharCode(new Uint8Array(rawData)[0]);
        const data = rawData.slice(1);
        switch (cmd) {
            case Command.OUTPUT: {
                const decoded = this.textDecoder.decode(data);
                
                // 关键拦截：如果在 Web 模式下后端尝试重新开启鼠标模式，直接过滤掉这些指令
                if (this.webMouseMode) {
                    if (decoded.includes('\x1b[?1000h') || decoded.includes('\x1b[?1002h') || 
                        decoded.includes('\x1b[?1003h') || decoded.includes('\x1b[?1006h')) {
                        console.log('[ttyd] Blocked mouse-enable sequence from server');
                        return;
                    }
                }

                if (this.serverDataCb && this.serverDataCb(decoded)) return;
                this.writeFunc(data);
                break;
            }
            case Command.SET_WINDOW_TITLE: this.title = this.textDecoder.decode(data); document.title = this.title; break;
            case Command.SET_PREFERENCES:
                this.applyPreferences({ ...this.options.clientOptions, ...JSON.parse(this.textDecoder.decode(data)), ...this.parseOptsFromUrlQuery(window.location.search) } as Preferences);
                break;
            default: break;
        }
    }

    @bind
    private applyPreferences(prefs: Preferences) {
        const { terminal, fitAddon, register } = this;
        if (prefs.enableZmodem || prefs.enableTrzsz) {
            this.zmodemAddon = new ZmodemAddon({ zmodem: prefs.enableZmodem, trzsz: prefs.enableTrzsz, windows: prefs.isWindows, trzszDragInitTimeout: prefs.trzszDragInitTimeout, onSend: this.sendCb, sender: this.sendData, writer: this.writeData });
            this.writeFunc = data => this.zmodemAddon?.consume(data);
            terminal.loadAddon(register(this.zmodemAddon));
        }
        for (const [key, value] of Object.entries(prefs)) {
            switch (key) {
                case 'rendererType': this.setRendererType(value); break;
                case 'disableLeaveAlert': if (value) window.removeEventListener('beforeunload', this.onWindowUnload); break;
                case 'disableResizeOverlay': if (value) this.resizeOverlay = false; break;
                case 'disableReconnect': if (value) { this.reconnect = false; this.doReconnect = false; } break;
                case 'enableSixel': if (value) terminal.loadAddon(register(new ImageAddon())); break;
                case 'closeOnDisconnect': if (value) { this.closeOnDisconnect = true; this.reconnect = false; this.doReconnect = false; } break;
                case 'titleFixed': if (!value) return; this.titleFixed = value; document.title = value; break;
                case 'unicodeVersion': if (value == 11) { terminal.loadAddon(new Unicode11Addon()); terminal.unicode.activeVersion = '11'; } break;
                default:
                    if (terminal.options[key] instanceof Object) { terminal.options[key] = Object.assign({}, terminal.options[key], value); }
                    else { terminal.options[key] = value; }
                    if (key.indexOf('font') === 0) fitAddon.fit();
                    break;
            }
        }
    }

    @bind
    private setRendererType(value: RendererType) {
        const { terminal } = this;
        const disposeCanvas = () => { try { this.canvasAddon?.dispose(); } catch {} this.canvasAddon = undefined; };
        const disposeWebgl = () => { try { this.webglAddon?.dispose(); } catch {} this.webglAddon = undefined; };
        const enableCanvas = () => { if (this.canvasAddon) return; this.canvasAddon = new CanvasAddon(); disposeWebgl(); try { terminal.loadAddon(this.canvasAddon); } catch { disposeCanvas(); } };
        const enableWebgl = () => { if (this.webglAddon) return; this.webglAddon = new WebglAddon(); disposeCanvas(); try { this.webglAddon.onContextLoss(() => this.webglAddon?.dispose()); terminal.loadAddon(this.webglAddon); } catch { disposeWebgl(); enableCanvas(); } };
        switch (value) {
            case 'canvas': enableCanvas(); break;
            case 'webgl': enableWebgl(); break;
            case 'dom': disposeWebgl(); disposeCanvas(); break;
            default: break;
        }
    }
}
