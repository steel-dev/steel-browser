import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { WebContainerProcess } from '@webcontainer/api';
import 'xterm/css/xterm.css';

interface TerminalComponentProps {
    containerRef: React.RefObject<HTMLDivElement>;
    shellProcess: WebContainerProcess | null;
}

export function TerminalComponent({
    containerRef,
    shellProcess
}: TerminalComponentProps) {
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const writerRef = useRef<WritableStreamDefaultWriter | null>(null);

    useEffect(() => {
        if (!containerRef.current || !shellProcess) return;

        const term = new Terminal();
        const fitAddon = new FitAddon();

        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        writerRef.current = shellProcess.input.getWriter();

        shellProcess.output.pipeTo(new WritableStream({
            write(data) { term.write(data) }
        }));

        term.onData(data => {
            if (writerRef.current) {
                writerRef.current.write(data);
            }
        });

        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            term.dispose();

            if (writerRef.current) {
                writerRef.current.releaseLock();
                writerRef.current = null;
            }
        };
    }, [shellProcess, containerRef]);

    return null;
}