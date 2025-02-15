import { useEffect } from 'react';
import { debounce } from 'lodash-es';
import type { WebContainer } from '@webcontainer/api';

export function useFileSync(
    webContainer: WebContainer | null,
    filePath: string,
    content: string
) {
    useEffect(() => {
        if (!webContainer) return;

        const writeFile = debounce(async (code: string) => {
            try {
                await webContainer.fs.writeFile(filePath, code);
                console.log('File updated:', filePath);
            } catch (error) {
                console.error('Error writing file:', error);
            }
        }, 500);

        writeFile(content);

        return () => writeFile.cancel();
    }, [content, webContainer, filePath]);
}