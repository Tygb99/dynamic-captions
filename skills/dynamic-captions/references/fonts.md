# 글꼴 고르기 (무료 5종과 내 글꼴 쓰는 법)

자막 글꼴은 `make-captions.mjs`의 `--font` 로 정합니다. 안 정하면 스타일마다 원래 글꼴을 씁니다(본문은 Pretendard, 큰 핵심어는 Black Han Sans 등).

## 함께 들어 있는 무료 글꼴 5종
모두 SIL Open Font License(OFL) 글꼴이라 영상 자막에 상업적으로 써도 됩니다(글꼴 파일만 따로 파는 것은 안 됩니다). 라이선스 전문은 `assets/fonts/*-OFL.txt` 에 있습니다.

| `--font` 값 | 글꼴 | 어울리는 영상 | 파일 |
|---|---|---|---|
| `pretendard` | Pretendard ExtraBold | 깔끔한 고딕. 거의 모든 영상의 기본 | `Pretendard-ExtraBold.woff2` |
| `black-han` | Black Han Sans | 굵고 큰 제목체. 짧은 핵심어, 쇼츠, 랩 | `BlackHanSans-Regular.ttf` |
| `plex` | IBM Plex Sans KR Bold | 차분한 고딕. 설명·강의 영상 | `IBMPlexSansKR-Bold.ttf` |
| `gaegu` | Gaegu Bold | 손글씨 느낌. 일상·여행·귀여운 영상 | `Gaegu-Bold.ttf` |
| `myeongjo` | 나눔명조 ExtraBold | 명조(바탕체). 시·낭독·감성 영상 | `NanumMyeongjo-ExtraBold.ttf` |

## 쓰는 방법
```bash
# 영상 전체 자막을 한 글꼴로
node scripts/make-captions.mjs --video my.mp4 --words words.json --out job --font myeongjo

# 큰 핵심어만 다른 글꼴로 (hero-key, stamp, impact-wide 같은 스타일의 큰 글자)
node scripts/make-captions.mjs ... --font plex --font-key black-han

# 내가 가진 글꼴 파일로 (.ttf .otf .woff .woff2)
node scripts/make-captions.mjs ... --font "C:\fonts\MyFont.ttf"
```
`start.mjs` 로 시작할 때도 같은 옵션을 붙이면 그대로 넘어갑니다(`node scripts/start.mjs my.mp4 --font gaegu`).

## 알아 둘 점
- **없는 글자는 Pretendard로 채웁니다.** 내 글꼴에 없는 글자(희귀한 한자, 이모지, 쓰지 않은 손글씨 글자)가 나오면 그 글자만 Pretendard로 그려서 네모(□)가 안 보이게 합니다. 그래서 글자 수가 적은 손글씨 글꼴도 쓸 수 있습니다.
- **굵기는 파일이 정합니다.** 파일 하나의 모양만 쓰고, 컴퓨터가 억지로 굵게 만들지 않습니다. 굵은 자막을 원하면 Bold·ExtraBold 파일을 고르세요.
- **글꼴이 바뀌면 글자 폭이 달라집니다.** 시안(`render.mjs preview`)에서 글씨 크기·구역 점검이 다시 돌므로, 경고가 나오면 `--scale` 을 조금 줄이세요.
- **라이선스는 직접 확인하세요.** 남이 만든 글꼴(눈누, Google Fonts, 구매한 글꼴 등)은 영상·상업 이용 조건이 글꼴마다 다릅니다. 이 스킬은 사용 조건을 검사해 주지 않습니다. 이 저장소에 함께 넣어도 되는 것은 위 5종처럼 라이선스가 명확한 것뿐입니다.
- **내 손글씨를 글꼴로** 쓰는 방법은 `references/handwriting-font.md` 에 있습니다(영상에 나오는 글자만 쓰는 방식).

## 설명 영상에는 차분한 자막
설명·강의 영상은 색 블록이나 튀는 효과보다 읽기 편한 자막이 낫습니다. `--style plain` 은 어두운 둥근 상자 안의 흰 글자 한 줄이 한꺼번에 나타나고, 색·단어별 효과가 없습니다(자동 섞기 `mix` 에는 들어가지 않습니다).
```bash
node scripts/make-captions.mjs ... --scale 0.85 --shade 0.3
node scripts/render.mjs final job --style plain
```
