import { useEffect, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import type { WebContainerProcess, FileSystemTree } from '@webcontainer/api';

export function useWebContainer(initialFiles: FileSystemTree) {
    const [webContainer, setWebContainer] = useState<WebContainer | null>(null);
    const [shellProcess, setShellProcess] = useState<WebContainerProcess | null>(null);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                const wc = await WebContainer.boot();
                await wc.mount(initialFiles);
                const sp = await wc.spawn('bash');
                if (mounted) {
                    setWebContainer(wc);
                    setShellProcess(sp);
                }
            } catch (error) {
                console.error('WebContainer initialization failed:', error);
            }
        };

        init();
        return () => {
            mounted = false;
            webContainer?.teardown();
            shellProcess?.kill();
        };
    }, []);

    return { webContainer, shellProcess };
}