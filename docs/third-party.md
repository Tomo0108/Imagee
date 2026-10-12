# 使用しているライブラリと AI モデル

Imagee は次のオープンソースのソフトウェアとモデルを利用しています。

## AI モデル（`public/models/`）

| ファイル | 用途 | 元のモデル | ライセンス |
| --- | --- | --- | --- |
| `segment.onnx` | 被写体の選択・背景削除 | U²-Net（Qin et al., 2020）を軽量化した rembg の `silueta` モデル | Apache License 2.0（U²-Net）、MIT（rembg） |
| `upscale-x4.onnx` | 高解像度化（2 倍・4 倍） | Real-ESRGAN `realesr-general-x4v3`（Xintao Wang et al.） | BSD 3-Clause |

`upscale-x4.onnx` は公開されている PyTorch の重みを [`scripts/models/esrgan2onnx.py`](../scripts/models/esrgan2onnx.py) で ONNX に変換したものです（`python esrgan2onnx.py realesr-general-x4v3.pth upscale-x4.onnx`、onnx と numpy が必要）。

空の選択はモデルを使わず、色と輪郭から判定しています。不要物の消去はパッチ合成（PatchMatch を使った画像補完）で、学習済みモデルは使っていません。

## ライブラリ

| 名前 | 用途 | ライセンス |
| --- | --- | --- |
| ONNX Runtime Web | AI モデルの実行 | MIT |
| React | 画面 | MIT |
| Electron | デスクトップ版 | MIT |
| ag-psd | PSD の読み書き | MIT |
| fflate | zip（.imagee、一括処理） | MIT |
| lucide-react | アイコン | ISC |
| Inter / Noto Sans JP（Fontsource） | フォント | SIL Open Font License 1.1 |
