"use strict";

const SSE_BLOCK_SEPARATOR = "\n\n";
const SSE_LINE_SEPARATOR = "\n";
const SSE_DEFAULT_EVENT = "message";
const SSE_FIELD_PATTERN = /^([^:]*):? ?(.*)$/;

// Reads a text/event-stream body by hand: the built-in SSE client cannot send the POST body of a search.
class SseReader {
    async read(stream, onEvent) {
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            // A "\r" left at the end of a chunk is joined to its "\n" by the next chunk, then normalized.
            buffer = (buffer + value).replaceAll("\r\n", SSE_LINE_SEPARATOR);
            const blocks = buffer.split(SSE_BLOCK_SEPARATOR);
            buffer = blocks.pop();
            await this.#dispatchAll(reader, blocks, onEvent);
        }
        await this.#dispatchAll(reader, [buffer], onEvent);
    }

    async #dispatchAll(reader, blocks, onEvent) {
        try {
            for (const block of blocks) this.#dispatch(block, onEvent);
        } catch (error) {
            // A bad event must not leave the response downloading in the background.
            await reader.cancel();
            throw error;
        }
    }

    #dispatch(block, onEvent) {
        let type = SSE_DEFAULT_EVENT;
        const dataLines = [];
        for (const line of block.split(SSE_LINE_SEPARATOR)) {
            if (line === "" || line.startsWith(":")) continue;
            const [, field, value] = line.match(SSE_FIELD_PATTERN);
            if (field === "event") type = value;
            if (field === "data") dataLines.push(value);
        }
        if (dataLines.length === 0) return;
        onEvent(type, this.#parseData(type, dataLines.join(SSE_LINE_SEPARATOR)));
    }

    #parseData(type, data) {
        try {
            return JSON.parse(data);
        } catch (error) {
            throw new Error(`Événement « ${type} » illisible : ${error.message}`);
        }
    }
}
