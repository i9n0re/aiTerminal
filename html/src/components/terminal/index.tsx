import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import type { IDisposable } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';
import { Modal } from '../modal';

interface Pane {
    index: number;
    command: string;
    active: boolean;
}

interface WindowInfo {
    index: number;
    name: string;
    active: boolean;
    panes: Pane[];
}

interface Props extends XtermOptions {
    id: string;
}

interface State {
    modal: boolean;
    title: string;
    toolbarVisible: boolean;
    sidebarVisible: boolean;
    windows: WindowInfo[];
    ready: boolean;
    webMouseMode: boolean;
}

export class Terminal extends Component<Props, State> {
    private container: HTMLElement;
    private terminalEl: HTMLElement;
    private xterm: Xterm;
    private titleDisposable: IDisposable | undefined;

    constructor(props: Props) {
        super();
        this.xterm = new Xterm(props, this.showModal);
        this.state = {
            modal: false,
            title: 'Terminal',
            toolbarVisible: true,
            sidebarVisible: false,
            windows: [],
            ready: false,
            webMouseMode: false,
        };
    }

    async componentDidMount() {
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        await this.xterm.refreshToken();
        this.xterm.open(this.terminalEl);
        if (window.term && window.term.fit) window.term.fit();
        this.xterm.connect();
        this.initTouchScroll();
        this.initVisualViewport();

        this.titleDisposable = this.xterm.onTitleChange(newTitle => {
            if (newTitle && newTitle !== this.state.title) this.setState({ title: newTitle });
        });

        this.xterm.onServerData(data => {
            if (data.includes('__TMUX_DATA__:')) {
                this.parseNestedData(data);
                return true;
            }
            return false;
        });

        setTimeout(() => this.setState({ ready: true }), 50);
    }

    @bind
    parseNestedData(data: string) {
        // 格式: __TMUX_DATA__:W_IDX:W_NAME:W_ACTIVE:P_IDX:P_CMD:P_ACTIVE
        const regex = /__TMUX_DATA__:(\d+):([^:]+):([01]):(\d+):([^:\r\n]+):([01])/g;
        const windowMap = new Map<number, WindowInfo>();
        let match;

        while ((match = regex.exec(data)) !== null) {
            const wIdx = parseInt(match[1], 10);
            const wName = match[2];
            const wActive = match[3] === '1';
            const pIdx = parseInt(match[4], 10);
            const pCmd = match[5];
            const pActive = match[6] === '1';

            if (!windowMap.has(wIdx)) {
                windowMap.set(wIdx, { index: wIdx, name: wName, active: wActive, panes: [] });
            }
            windowMap.get(wIdx)!.panes.push({ index: pIdx, command: pCmd, active: pActive });
        }

        const sortedWindows = Array.from(windowMap.values()).sort((a, b) => a.index - b.index);
        sortedWindows.forEach(w => w.panes.sort((a, b) => a.index - b.index));
        
        console.log('[ttyd] Parsed nested tmux structure:', sortedWindows);
        this.setState({ windows: sortedWindows });
    }

    @bind refreshWindows() { this.xterm.sendCommand('4'); }
    
    @bind 
    selectPane(wIdx: number, pIdx: number) {
        console.log(`[ttyd] Switching to Window ${wIdx}, Pane ${pIdx}`);
        this.xterm.sendCommand('5', `${wIdx}:${pIdx}`);
    }

    @bind
    toggleMouseMode() {
        const newMode = !this.state.webMouseMode;
        this.setState({ webMouseMode: newMode });
        this.xterm.setWebMouseMode(newMode);
    }

    initVisualViewport() {
        if (!window.visualViewport) return;
        let fitTimeout: ReturnType<typeof setTimeout>;
        const updateLayout = () => {
            if (!this.container || !this.terminalEl) return;
            if (window.term && window.term.fit) {
                clearTimeout(fitTimeout);
                fitTimeout = setTimeout(() => window.term.fit(), 300);
            }
        };
        window.visualViewport.addEventListener('resize', updateLayout);
        const resizeObserver = new ResizeObserver(updateLayout);
        resizeObserver.observe(this.container);
        updateLayout();
    }

    initTouchScroll() {
        let touchStartY = 0;
        const el = this.terminalEl;
        if (!el) return;
        el.addEventListener('touchstart', ((e: TouchEvent) => {
            if (e.touches.length === 1) touchStartY = e.touches[0].clientY;
        }) as unknown as EventListener, { passive: false });
        el.addEventListener('touchmove', ((e: TouchEvent) => {
            if (e.touches.length === 1) {
                const deltaY = touchStartY - e.touches[0].clientY;
                if (Math.abs(deltaY) > 8) {
                    const canvas = el.querySelector('.xterm-link-layer + canvas');
                    if (canvas) {
                        const wheelEvent = new WheelEvent('wheel', { deltaY: deltaY * (Math.abs(deltaY) > 30 ? 3 : 1), deltaMode: 0, bubbles: true, cancelable: true });
                        canvas.dispatchEvent(wheelEvent);
                    }
                    touchStartY = e.touches[0].clientY;
                }
                if (e.cancelable) e.preventDefault();
            }
        }) as unknown as EventListener, { passive: false });
    }

    componentWillUnmount() {
        this.xterm.dispose();
        if (this.titleDisposable) this.titleDisposable.dispose();
    }

    @bind sendKey(key: string) { this.xterm.sendData(key); }
    @bind sendTmuxKey(action: string) { this.xterm.sendData('\x02' + action); }
    @bind toggleToolbar() { this.setState({ toolbarVisible: !this.state.toolbarVisible }); }
    @bind toggleSidebar() {
        this.setState({ sidebarVisible: !this.state.sidebarVisible }, () => {
            if (this.state.sidebarVisible) this.refreshWindows();
        });
    }

    render({ id }: Props, { modal, title, toolbarVisible, sidebarVisible, windows, ready, webMouseMode }: State) {
        const transitionStyle = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        const sidebarWidth = '260px';

        return (
            <div style={{ 
                position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000',
                opacity: ready ? 1 : 0, transition: 'opacity 0.2s ease-in'
            }}>
                <div 
                    ref={c => (this.container = c as HTMLElement)}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden' }}
                >
                    <div style={{
                        position: 'absolute', top: '15%', left: '50%', transform: 'translate(-50%, -50%)',
                        fontSize: '15vw', fontWeight: '900', color: 'rgba(255, 0, 0, 0.15)',
                        pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap',
                        userSelect: 'none', textAlign: 'center', width: '100%', overflow: 'hidden',
                    }}>{title}</div>

                    <div id={id} ref={c => (this.terminalEl = c as HTMLElement)} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
                </div>

                <div style={{
                    position: 'fixed', top: 0, right: sidebarVisible ? '0' : `-${sidebarWidth}`,
                    width: sidebarWidth, height: '100%', transition: transitionStyle,
                    background: 'rgba(26, 26, 26, 0.95)', borderLeft: '1px solid #333',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden', color: '#ccc', zIndex: 10001,
                    backdropFilter: 'blur(10px)', webkitBackdropFilter: 'blur(10px)',
                    boxShadow: sidebarVisible ? '-4px 0 16px rgba(0,0,0,0.5)' : 'none',
                }}>
                    <div style={{ padding: '16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: 'bold', background: '#252525', whiteSpace: 'nowrap' }}>
                        <span>Sessions Explorer</span>
                        <button onClick={this.refreshWindows} style={{ background: 'none', border: 'none', color: '#007aff', cursor: 'pointer', fontSize: '18px' }}>↻</button>
                    </div>

                    <div style={{ padding: '12px 16px', background: '#202020', borderBottom: '1px solid #333', whiteSpace: 'nowrap' }}>
                        <button onClick={this.toggleMouseMode} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', background: webMouseMode ? '#ff9500' : '#333', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s' }}>
                            {webMouseMode ? '✓ Web Selection' : 'Terminal (Tmux)'}
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                        {windows.map(win => (
                            <div key={win.index} style={{ marginBottom: '12px' }}>
                                {/* Window Header */}
                                <div style={{ 
                                    padding: '8px 16px', background: '#2a2a2a', fontSize: '11px', color: '#888', 
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    borderLeft: win.active ? '3px solid #007aff' : 'none'
                                }}>
                                    <span>WINDOW {win.index}: {win.name.toUpperCase()}</span>
                                    {win.active && <span style={{ color: '#007aff' }}>ACTIVE</span>}
                                </div>
                                
                                {/* Panes (Sessions) */}
                                {win.panes.map(pane => (
                                    <div 
                                        key={pane.index} 
                                        onClick={() => this.selectPane(win.index, pane.index)}
                                        style={{
                                            padding: '10px 16px 10px 28px', margin: '2px 8px', borderRadius: '6px',
                                            background: pane.active ? 'linear-gradient(90deg, #007aff, #005bb5)' : 'transparent',
                                            color: pane.active ? '#fff' : '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px',
                                            transition: 'all 0.2s ease', border: pane.active ? 'none' : '1px solid transparent'
                                        }}
                                    >
                                        <div style={{ 
                                            width: '8px', height: '8px', borderRadius: '50%', 
                                            background: pane.active ? '#fff' : (pane.command.includes('python') || pane.command.includes('gemini') ? '#28a745' : '#555') 
                                        }} />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontWeight: pane.active ? 'bold' : 'normal' }}>Session {pane.index}</span>
                                            <span style={{ fontSize: '10px', opacity: 0.6 }}>Running: {pane.command}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    
                    <div style={{ padding: '16px', background: '#252525', borderTop: '1px solid #333', whiteSpace: 'nowrap' }}>
                        <button onClick={() => this.sendTmuxKey('c')} style={{ background: '#28a745', border: 'none', color: '#fff', padding: '10px', width: '100%', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px' }}>+ New Window</button>
                        <button onClick={() => this.sendTmuxKey('w')} style={{ background: '#6c757d', border: 'none', color: '#fff', padding: '10px', width: '100%', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Interactive Menu</button>
                    </div>
                </div>

                <div style={{
                    position: 'fixed', top: '50%', right: sidebarVisible ? sidebarWidth : '0',
                    transform: 'translateY(-50%)', zIndex: 10000, display: 'flex',
                    flexDirection: 'column', gap: '8px', padding: '12px 8px',
                    background: 'rgba(30, 30, 30, 0.7)', borderTopLeftRadius: '12px',
                    borderBottomLeftRadius: '12px', backdropFilter: 'blur(12px)',
                    webkitBackdropFilter: 'blur(12px)', boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
                    transition: transitionStyle,
                }} className="quick-keys">
                    <button style={{ background: 'rgba(0, 150, 255, 0.3)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={this.toggleSidebar}>
                        {sidebarVisible ? '→' : '田'}
                    </button>
                    <button style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={this.toggleToolbar}>
                        {toolbarVisible ? '»' : '«'}
                    </button>

                    {toolbarVisible && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x1b')}>Esc</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey('c')}>New</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendTmuxKey(',')}>Rename</button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', minWidth: 'unset', flex: 1 }} onClick={() => this.sendKey('\x1b[D')}>←</button>
                                <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', minWidth: 'unset', flex: 1 }} onClick={() => this.sendKey('\x1b[C')}>→</button>
                            </div>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\t')}>Tab</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x06')}>Ctrl+F</button>
                            <button style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 12px', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold' }} onClick={() => this.sendKey('\x03')}>Ctrl+C</button>
                        </div>
                    )}
                </div>

                <Modal show={modal}>
                    <label class="file-label">
                        <input onChange={this.sendFile} class="file-input" type="file" multiple />
                        <span class="file-cta">Choose files…</span>
                    </label>
                </Modal>
            </div>
        );
    }

    @bind showModal() { this.setState({ modal: true }); }
    @bind sendFile(event: Event) {
        this.setState({ modal: false });
        const files = (event.target as HTMLInputElement).files;
        if (files) this.xterm.sendFile(files);
    }
}
