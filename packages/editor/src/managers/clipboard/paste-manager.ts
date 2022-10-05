import { BaseBlockModel } from '@blocksuite/store';
import { marked } from 'marked';
import { EditorContainer } from '../../components';
import { HtmlParser } from './content-parser/parse-html';
import { TextParser } from './content-parser/parse-text';
import { MarkdownUtils } from './markdown-utils';
import { CLIPBOARD_MIMETYPE, OpenBlockInfo } from './types';

export class PasteManager {
  private _editor: EditorContainer;

  // The event handler will get the most needed clipboard data based on this array order
  private static _optimalMimeTypes: string[] = [
    CLIPBOARD_MIMETYPE.BLOCKS_CLIP_WRAPPED,
    CLIPBOARD_MIMETYPE.HTML,
    CLIPBOARD_MIMETYPE.TEXT,
  ];

  constructor(editor: EditorContainer) {
    this._editor = editor;
    this.handlePaste = this.handlePaste.bind(this);
  }

  public async handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    e.stopPropagation();

    const blocks = await this._clipboardEvent2Blocks(e);
    this._insertBlocks(blocks);
  }

  private async _clipboardEvent2Blocks(e: ClipboardEvent) {
    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return;
    }

    const isPureFile = PasteManager._isPureFileInClipboard(clipboardData);
    if (isPureFile) {
      return this._file2Blocks(clipboardData);
    }
    return this._clipboardData2Blocks(clipboardData);
  }

  // Get the most needed clipboard data based on `_optimalMimeTypes` order
  public getOptimalClip(clipboardData: ClipboardEvent['clipboardData']) {
    for (let i = 0; i < PasteManager._optimalMimeTypes.length; i++) {
      const mimeType = PasteManager._optimalMimeTypes[i];
      const data = clipboardData?.getData(mimeType);

      if (data) {
        return {
          type: mimeType,
          data: data,
        };
      }
    }

    return null;
  }

  private async _clipboardData2Blocks(clipboardData: DataTransfer) {
    const optimalClip = this.getOptimalClip(clipboardData);
    if (optimalClip?.type === CLIPBOARD_MIMETYPE.BLOCKS_CLIP_WRAPPED) {
      const clipInfo = JSON.parse(optimalClip.data);
      return clipInfo.data;
    }

    const textClipData = escape(clipboardData.getData(CLIPBOARD_MIMETYPE.TEXT));

    const shouldConvertMarkdown =
      MarkdownUtils.checkIfTextContainsMd(textClipData);
    if (
      optimalClip?.type === CLIPBOARD_MIMETYPE.HTML &&
      !shouldConvertMarkdown
    ) {
      return HtmlParser.html2blocks(optimalClip.data);
    }

    if (shouldConvertMarkdown) {
      const md2html = marked.parse(textClipData);
      return HtmlParser.html2blocks(md2html);
    }

    return TextParser.text2blocks(textClipData);
  }

  private async _file2Blocks(
    clipboardData: DataTransfer
  ): Promise<OpenBlockInfo[]> {
    const file = PasteManager._getImageFile(clipboardData);
    if (file) {
      //  todo upload file to file server
      return [];
    }
    return [];
  }

  private static _isPureFileInClipboard(clipboardData: DataTransfer) {
    const types = clipboardData.types;
    return (
      (types.length === 1 && types[0] === 'Files') ||
      (types.length === 2 &&
        (types.includes('text/plain') || types.includes('text/html')) &&
        types.includes('Files'))
    );
  }

  private static _getImageFile(clipboardData: DataTransfer) {
    const files = clipboardData.files;
    if (files && files[0] && files[0].type.indexOf('image') > -1) {
      return files[0];
    }
    return;
  }
  // TODO Max 15 deeper
  private _insertBlocks(blocks: OpenBlockInfo[]) {
    if (blocks.length === 0) {
      return;
    }
    const currentSelectionInfo = this._editor.selection.selectionInfo;

    if (
      currentSelectionInfo.type === 'Range' ||
      currentSelectionInfo.type === 'Caret'
    ) {
      // TODO split selected block case
      const selectedBlock = this._editor.store.getBlockById(
        currentSelectionInfo.focusBlockId
      );
      let parent = selectedBlock;
      let index = 0;
      if (selectedBlock && selectedBlock.flavour !== 'page') {
        parent = this._editor.store.getParent(selectedBlock);
        index = (parent?.children.indexOf(selectedBlock) || -1) + 1;
      }
      const addBlockIds: string[] = [];
      parent && this._addBlocks(blocks, parent, index, addBlockIds);
      this._editor.selection.selectedBlockIds = addBlockIds;
    } else if (currentSelectionInfo.type === 'Block') {
      const selectedBlock = this._editor.store.getBlockById(
        currentSelectionInfo.selectedNodeIds[
          currentSelectionInfo.selectedNodeIds.length - 1
        ]
      );

      let parent = selectedBlock;
      let index = -1;
      if (selectedBlock && selectedBlock.flavour !== 'page') {
        parent = this._editor.store.getParent(selectedBlock);
        index = (parent?.children.indexOf(selectedBlock) || -1) + 1;
      }
      const addBlockIds: string[] = [];
      parent && this._addBlocks(blocks, parent, index, addBlockIds);
      this._editor.selection.selectedBlockIds = addBlockIds;
    }
  }

  private _addBlocks(
    blocks: OpenBlockInfo[],
    parent: BaseBlockModel,
    index: number,
    addBlockIds: string[]
  ) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockProps = {
        flavour: block.flavour as string,
      };
      const id = this._editor.store.addBlock(blockProps, parent, index + i);
      const model = this._editor.store.getBlockById(id);
      block.text && model?.text?.applyDelta(block.text);
      addBlockIds.push(id);
      model && this._addBlocks(block.children, model, 0, addBlockIds);
    }
  }
}
