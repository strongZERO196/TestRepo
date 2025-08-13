# アバター画像フォルダ

このディレクトリに各プレーヤーの顔画像を配置してください。

- 推奨ファイル名（席IDに対応）
  - 0: あなた → `player-0.png`
  - 1: Bot A → `player-1.png`
  - 2: Bot B → `player-2.png`
  - 3: Bot C → `player-3.png`
- 画像形式: PNG/JPG/SVG（正方形推奨、56×56〜128×128）
- 反映方法（例）
  - CSS 背景で反映: `document.getElementById('avatar-1').style.backgroundImage = 'url(assets/avatars/player-1.png)';`
  - `<img>`で反映: `document.getElementById('avatar-1').innerHTML = '<img src="assets/avatars/player-1.png" />'`

必要に応じてファイル名やマッピングは自由に変更してください。
