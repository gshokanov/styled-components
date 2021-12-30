/* eslint-disable no-underscore-dangle */
import React from 'react';
import type * as streamInternal from 'stream';
import { Readable } from 'stream';
import { IS_BROWSER, SC_ATTR, SC_ATTR_VERSION, SC_VERSION } from '../constants';
import StyleSheet from '../sheet';
import styledError from '../utils/error';
import getNonce from '../utils/nonce';
import StyleSheetManager from './StyleSheetManager';

declare const __SERVER__: boolean;

const CLOSING_TAG_R = /^\s*<\/[a-z]/i;

/**
 * Type for the pipe function provided by calling renderToPipeableStream
 * TODO: use corresponding type from @types/react-dom when available
 */
type PipeFn = (destination: streamInternal.Writable) => void;

export default class ServerStyleSheet {
  instance: StyleSheet;
  sealed: boolean;

  constructor() {
    this.instance = new StyleSheet({ isServer: true });
    this.sealed = false;
  }

  _emitSheetCSS = (): string => {
    const css = this.instance.toString();
    const nonce = getNonce();
    const attrs = [
      nonce && `nonce="${nonce}"`,
      `${SC_ATTR}="true"`,
      `${SC_ATTR_VERSION}="${SC_VERSION}"`,
    ];
    const htmlAttr = attrs.filter(Boolean).join(' ');

    return `<style ${htmlAttr}>${css}</style>`;
  };

  _guard() {
    if (!__SERVER__ || IS_BROWSER) {
      throw styledError(3);
    } else if (this.sealed) {
      throw styledError(2);
    }
  }

  _getNodeTransformStream(): streamInternal.Transform {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { Transform } = require('stream');

    const { instance: sheet, _emitSheetCSS } = this;

    return new Transform({
      transform: function appendStyleChunks(
        chunk: string,
        /* encoding */
        _: string,
        callback: Function
      ) {
        // Get the chunk and retrieve the sheet's CSS as an HTML chunk,
        // then reset its rules so we get only new ones for the next chunk
        const renderedHtml = chunk.toString();
        const html = _emitSheetCSS();

        sheet.clearTag();

        // prepend style html to chunk, unless the start of the chunk is a
        // closing tag in which case append right after that
        if (CLOSING_TAG_R.test(renderedHtml)) {
          const endOfClosingTag = renderedHtml.indexOf('>') + 1;
          const before = renderedHtml.slice(0, endOfClosingTag);
          const after = renderedHtml.slice(endOfClosingTag);

          this.push(before + html + after);
        } else {
          this.push(html + renderedHtml);
        }

        callback();
      },
    });
  }

  collectStyles(children: any): JSX.Element {
    if (this.sealed) {
      throw styledError(2);
    }

    return <StyleSheetManager sheet={this.instance}>{children}</StyleSheetManager>;
  }

  getStyleTags = (): string => {
    if (this.sealed) {
      throw styledError(2);
    }

    return this._emitSheetCSS();
  };

  getStyleElement = () => {
    if (this.sealed) {
      throw styledError(2);
    }

    const props = {
      [SC_ATTR]: '',
      [SC_ATTR_VERSION]: SC_VERSION,
      dangerouslySetInnerHTML: {
        __html: this.instance.toString(),
      },
    };

    const nonce = getNonce();
    if (nonce) {
      (props as any).nonce = nonce;
    }

    // v4 returned an array for this fn, so we'll do the same for v5 for backward compat
    return [<style {...props} key="sc-0-0" />];
  };

  interleaveWithNodeStream(input: Readable): streamInternal.Transform {
    this._guard();
    this.seal();

    const readableStream: Readable = input;
    const transformer = this._getNodeTransformStream();

    readableStream.on('error', err => {
      // forward the error to the transform stream
      transformer.emit('error', err);
    });

    return readableStream.pipe(transformer);
  }

  interleaveWithPipe(pipe: PipeFn): PipeFn {
    this._guard();
    this.seal();

    // Keep function signature the same, route all data through the transform stream
    // Error handling is done on the caller's side using renderToPipeableStream API
    return (destination) => {
      const transformStream = this._getNodeTransformStream();
      const outputStream = transformStream.pipe(destination);

      pipe(outputStream);
    };
  }

  seal = (): void => {
    this.sealed = true;
  };
}
