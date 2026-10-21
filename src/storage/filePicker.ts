/**
 * input 要素でファイルを選ばせる。
 * input を DOM に置いておかないと、ブラウザによっては選択前に破棄されて change が届かないことがある。
 */
export function pickFilesWithInput(
  options: { accept?: string; multiple?: boolean; directory?: boolean } = {},
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    if (options.accept) input.accept = options.accept;
    input.multiple = options.multiple ?? false;
    if (options.directory) input.webkitdirectory = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
