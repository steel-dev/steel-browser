import { FastifyReply, FastifyRequest } from "fastify";
import { spawn } from 'child_process';

export async function handleRunCode(request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) {
    const { code } = request.body;

    if (!code) {
        return reply.status(400).send({ error: "No code provided" });
    }

    try {
        const result = await executePythonCode(code);
        return reply.send(result);
    } catch (error) {
        if (error instanceof Error) {
            if (error.message.includes('Timeout')) {
                return reply.status(500).send({ error: "Execution timed out" });
            }
            return reply.status(500).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Unknown error occurred" });
    }
}

async function executePythonCode(code: string, timeout = 60000) {
    const pythonProcess = spawn('python', ['-c', code]);

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout;

    pythonProcess.stdout.on('data', (data) => stdout += data);
    pythonProcess.stderr.on('data', (data) => stderr += data);

    const exitCode = await Promise.race([
        new Promise<number>((resolve, reject) => {
            timeoutId = setTimeout(() => {
                pythonProcess.kill('SIGKILL');
                reject(new Error('Timeout: Execution took too long'));
            }, timeout);
            pythonProcess.on('close', (code) => {
                clearTimeout(timeoutId);
                resolve(code || 0);
            });
        })
    ]);

    return {
        result: stdout.trim(),
        error: stderr.trim(),
        exitCode
    };
}