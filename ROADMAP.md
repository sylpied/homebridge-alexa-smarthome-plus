# Feature roadmap

機器種別を一度に増やすと、HomeKit の状態表現と Alexa の能力表現の差によって誤操作が起きます。そのため、能力取得・状態取得・操作の三つを実機検証できた機能から追加します。

## 0.1.x — Foundation

- [x] 独立パッケージ化
- [x] 保存セッションの自動更新
- [x] 401 時の自動再認証開始
- [x] Alexa／HomeKit 機器名マッピング
- [x] ON/OFF 対応の未知機器を Switch として公開
- [ ] 認証状態と最終更新日時の診断ログ
- [ ] 設定内容を秘匿した診断レポート

## 0.2.x — Common accessories

- [ ] Contact／motion／leak センサー
- [ ] Window covering（ブラインド、カーテン、シャッター）
- [ ] Garage door
- [ ] Doorbell（カメラ映像を伴わない通知から検討）
- [ ] 独立した温湿度センサーの拡充

## 0.3.x — Alexa actions

- [x] Alexa 定型アクションを HomeKit スイッチとして公開
- [ ] Alexa シーンの実行
- [x] 押した後に自動で OFF へ戻るステートレス動作
- [x] UI で公開対象を選択

## 0.4.x — Media

- [ ] Television service
- [ ] 電源、再生、一時停止、音量、ミュート
- [ ] 入力一覧を取得できる機器の入力切替
- [ ] Echo スピーカーの再生制御

## Later / investigation required

- Camera streaming
- 複数 Amazon アカウント
- Alexa イベントのリアルタイム HomeKit 反映
- Matter 機器固有能力の変換

## Authentication policy

保存済みトークン／Cookie の更新と、期限切れ時の再認証開始は自動化します。Amazon のパスワード保存、MFA 回避、CAPTCHA 回避は実装しません。
