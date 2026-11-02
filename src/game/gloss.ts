// Her lines show each English sentence's Chinese meaning in full-width brackets: 「Nice!（不錯耶！）」. With 設定 › 中文翻譯
// turned off, the brackets are hidden on screen (they are never spoken anyway). Pure: no DOM, no storage.

/** the text without its （…） glosses; an unfinished 「（…」 at the end (still streaming) is hidden too */
export function hideGloss(text: string): string {
  return text.replace(/（[^（）]*）/g, ' ').replace(/（[^（）]*$/, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
}
