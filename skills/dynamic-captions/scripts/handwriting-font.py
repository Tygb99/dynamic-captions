#!/usr/bin/env python
"""손글씨 사진/스캔 -> TrueType 글꼴 (.ttf)
사용:
  python handwriting-font.py --layout <템플릿폴더>/layout.json --scans 사진1.jpg 사진2.jpg --out my-hand.ttf --name MyHand
사진은 시트 번호 순서대로 넣습니다(파일 이름에 sheet-02 처럼 번호가 있으면 그 번호를 씁니다).
필요: fontTools, opencv-python, numpy (Pillow는 선택)
"""
import argparse, json, re, sys, os
import numpy as np
import cv2
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
SCALE_UNITS_PER_CELL_H = 1000.0 / 270.0   # 칸 높이 270px 이 1em 정도가 되도록(글자 크기 기준)
SIDE_BEARING = 45                         # 글자 양옆 여백(글꼴 단위)
UP = 4                                    # 벡터화 전 확대 배수


def imread(path):
    data = np.fromfile(path, dtype=np.uint8)           # 한글 경로 대응
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"사진을 열 수 없습니다: {path}")
    return img


def find_marks(img, layout):
    """사진에서 네 모서리 검은 네모를 찾아 [좌상, 우상, 우하, 좌하] 중심을 돌려줍니다."""
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = 1600.0 / max(h, w)
    gs = cv2.resize(g, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else g
    sc = scale if scale < 1 else 1.0
    bg = cv2.medianBlur(gs, 51) if min(gs.shape) > 200 else gs
    norm = cv2.divide(gs, bg, scale=255)
    _, bw = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, cen = cv2.connectedComponentsWithStats(bw)
    cands = []
    for i in range(1, n):
        x, y, bw_, bh_, a = stats[i]
        if bw_ < 12 or bh_ < 12:
            continue
        if not (0.7 < bw_ / bh_ < 1.4):
            continue
        fill = a / float(bw_ * bh_)
        if fill < 0.85:                                   # 속이 꽉 찬 네모만
            continue
        cands.append((a, cen[i][0] / sc, cen[i][1] / sc))
    if len(cands) < 4:
        raise SystemExit("모서리 검은 네모 4개를 찾지 못했습니다. 네 모서리가 모두 보이게 다시 찍어 주세요.")
    # 비슷한 크기끼리 중에서 네 모서리를 하나씩 고름
    cands.sort(key=lambda c: -c[0])
    med = cands[min(len(cands) - 1, 3)][0]
    cands = [c for c in cands if 0.4 * med < c[0] < 2.5 * med] or cands
    pts = np.array([[c[1], c[2]] for c in cands], np.float32)
    corners_img = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    out = []
    for ci in corners_img:
        d = np.linalg.norm(pts - ci, axis=1)
        out.append(pts[int(np.argmin(d))])
    out = np.array(out, np.float32)
    if len(set(map(tuple, out.round(0)))) < 4:
        raise SystemExit("모서리 네모가 서로 겹쳐 인식됐습니다. 사진을 다시 찍어 주세요.")
    return out


def rectify(img, layout):
    W, H = layout["page"]
    src = find_marks(img, layout)
    dst = np.array(layout["markCenters"], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def ink_mask(page):
    """종이 밝기 얼룩을 지우고 '어두운 펜 자국'만 남깁니다. 하늘색 안내선·회색 라벨은 밝아서 걸러집니다."""
    g = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    bg = cv2.medianBlur(cv2.resize(g, None, fx=0.25, fy=0.25), 41)
    bg = cv2.resize(bg, (g.shape[1], g.shape[0]), interpolation=cv2.INTER_LINEAR)
    bg = cv2.GaussianBlur(bg, (0, 0), 15)
    norm = np.clip(g.astype(np.float32) / np.maximum(bg, 1) * 255, 0, 255)
    return norm  # 작을수록 진함


def cell_ink(norm, cell, inset=7, thr=155):
    x, y, w, h = cell["x"], cell["y"], cell["w"], cell["h"]
    sub = norm[y + inset:y + h - inset, x + inset:x + w - inset]
    soft = np.clip((thr + 30 - sub) / 60.0, 0, 1)         # 0~1, 부드러운 경계
    hard = (sub < thr).astype(np.uint8)
    # 작은 티끌 제거
    n, lab, st, _ = cv2.connectedComponentsWithStats(hard, connectivity=8)
    keep = np.zeros_like(hard)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= 25:
            keep[lab == i] = 1
    soft = soft * cv2.dilate(keep, np.ones((5, 5), np.uint8))
    return soft.astype(np.float32), int(keep.sum()), inset


def contours_to_glyph(soft, ox, oy, base_y, cell_w, units):
    """soft: 0~1 잉크 맵(칸 안쪽). ox,oy: soft 의 (0,0)이 칸 안에서 갖는 위치. base_y: 칸 안 기준선 y(px)."""
    ys, xs = np.where(soft > 0.5)
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    pad = 3
    sub = soft[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
    sx0, sy0 = max(0, x0 - pad), max(0, y0 - pad)
    big = cv2.resize(sub, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), 1.6)
    mask = (big > 0.5).astype(np.uint8) * 255
    mask = cv2.copyMakeBorder(mask, 2, 2, 2, 2, cv2.BORDER_CONSTANT, value=0)
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return None
    # 좌표 변환: 확대 좌표 -> 칸 px -> 글꼴 단위. 왼쪽 여백은 SIDE_BEARING.
    left_px = ox + sx0 - 2.0 / UP
    top_px = oy + sy0 - 2.0 / UP
    ink_w_px = (x1 - x0)
    polys = []
    for i, c in enumerate(cs):
        if abs(cv2.contourArea(c)) < 6 * UP * UP:              # 아주 작은 점은 버림
            continue
        ap = cv2.approxPolyDP(c, 0.9, True)[:, 0, :].astype(np.float64)
        if len(ap) < 3:
            continue
        px = left_px + ap[:, 0] / UP                          # 칸 안 x(px)
        py = top_px + ap[:, 1] / UP                           # 칸 안 y(px)
        gx = (px - (ox + x0)) * units + SIDE_BEARING
        gy = (base_y - py) * units
        area = 0.5 * np.sum(gx * np.roll(gy, -1) - np.roll(gx, -1) * gy)
        is_hole = hier[0][i][3] != -1
        # TrueType: 바깥은 시계방향(y 위쪽 기준 면적<0), 구멍은 반시계(면적>0)
        want_neg = not is_hole
        if (area < 0) != want_neg:
            gx, gy = gx[::-1], gy[::-1]
        polys.append((np.rint(gx).astype(int), np.rint(gy).astype(int)))
    if not polys:
        return None
    adv = int(round(ink_w_px * units)) + 2 * SIDE_BEARING
    return polys, adv


def build_font(glyphs, name, out):
    order = [".notdef", "space"] + [g["gname"] for g in glyphs]
    cmap = {0x20: "space"}
    for g in glyphs:
        cmap[ord(g["char"])] = g["gname"]
    pens = {}
    empty = TTGlyphPen(None).glyph()
    pens[".notdef"] = empty
    pens["space"] = empty
    metrics = {".notdef": (500, 0), "space": (320, 0)}
    for g in glyphs:
        pen = TTGlyphPen(None)
        for gx, gy in g["polys"]:
            pen.moveTo((int(gx[0]), int(gy[0])))
            for k in range(1, len(gx)):
                pen.lineTo((int(gx[k]), int(gy[k])))
            pen.closePath()
        pens[g["gname"]] = pen.glyph()
        xs = np.concatenate([p[0] for p in g["polys"]])
        metrics[g["gname"]] = (g["adv"], int(xs.min()))
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(pens)
    # lsb 는 실제 글리프 경계에서 다시 계산됩니다
    fb.setupHorizontalMetrics({k: (v[0], v[1]) for k, v in metrics.items()})
    fb.setupHorizontalHeader(ascent=900, descent=-300)
    fb.setupNameTable({"familyName": name, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-300, usWinAscent=1000, usWinDescent=350, sxHeight=500, sCapHeight=700)
    fb.setupPost()
    fb.save(out)


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="손글씨 사진 -> ttf")
    ap.add_argument("--layout", required=True)
    ap.add_argument("--scans", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="MyHand")
    ap.add_argument("--min-ink", type=int, default=120, help="이보다 잉크 픽셀이 적으면 안 쓴 칸으로 봅니다")
    ap.add_argument("--debug-dir", default=None, help="펴 놓은 시트·칸 그림을 저장할 폴더(문제 찾기용)")
    a = ap.parse_args()

    layout = json.load(open(a.layout, encoding="utf-8"))
    sheets = {s["index"]: s for s in layout["sheets"]}
    # 사진 -> 시트 번호
    used, pairs = set(), []
    for i, p in enumerate(a.scans):
        m = re.search(r"sheet[-_ ]?0*(\d+)", os.path.basename(p), re.I)
        idx = int(m.group(1)) if m and int(m.group(1)) in sheets and int(m.group(1)) not in used else None
        pairs.append([p, idx])
    free = [k for k in sorted(sheets) if k not in {q for _, q in pairs if q}]
    for pr in pairs:
        if pr[1] is None:
            pr[1] = free.pop(0) if free else None
    cw, ch = layout["cell"]
    base_y = ch * layout["baselineRatio"] - 7           # inset 7 보정 전의 칸 안 기준선은 아래서 다시 계산
    units = SCALE_UNITS_PER_CELL_H
    glyphs, missing, notes = [], [], []
    seen_sheets = set()
    for path, idx in pairs:
        if idx is None:
            notes.append(f"시트 번호를 정하지 못해 건너뜀: {path}")
            continue
        seen_sheets.add(idx)
        img = imread(path)
        page = rectify(img, layout)
        norm = ink_mask(page)
        if a.debug_dir:
            os.makedirs(a.debug_dir, exist_ok=True)
            cv2.imencode(".png", page)[1].tofile(os.path.join(a.debug_dir, f"rectified-{idx:02d}.png"))
        for cell in sheets[idx]["cells"]:
            soft, ink_px, inset = cell_ink(norm, cell)
            if ink_px < a.min_ink:
                missing.append(cell["char"])
                continue
            r = contours_to_glyph(soft, 0, 0, ch * layout["baselineRatio"] - inset, cw, units)
            if r is None:
                missing.append(cell["char"])
                continue
            polys, adv = r
            glyphs.append({"char": cell["char"], "gname": "uni%04X" % ord(cell["char"]), "polys": polys, "adv": adv})
    for k in sorted(sheets):
        if k not in seen_sheets:
            for c in sheets[k]["cells"]:
                missing.append(c["char"])
            notes.append(f"사진이 없는 시트 {k}: 그 시트의 글자는 모두 빠집니다")
    if not glyphs:
        raise SystemExit("글자를 하나도 찾지 못했습니다.")
    build_font(glyphs, a.name, a.out)
    print(json.dumps({"out": os.path.abspath(a.out), "glyphs": len(glyphs),
                      "included": "".join(g["char"] for g in glyphs),
                      "missing_count": len(missing), "missing": "".join(missing), "notes": notes},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()


