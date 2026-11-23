package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"

	"golang.org/x/image/draw"
)

// icons makes the app's icons from internal/desktop/assets/icon.png (run from the root):
//
//   - internal/desktop/assets/icon-mac.png: on a macOS icon's grid, the mark's square at 824 of
//     1024 pixels with the room around it a Mac icon has (kumo, 2026-11-22: drawn edge to edge, it
//     stood larger than every other icon in the Dock), for the Dock (gui.go) and the bundle's icns;
//   - cmd/iridium/rsrc_windows_{amd64,arm64}.syso: the program's icon for Windows (Explorer, the
//     task bar, each window's), group 3 as Wails looks for it, one PNG a size.
//
// The files are kept in git: a build needs no tool of its own.
func icons() error {
	f, err := os.Open("internal/desktop/assets/icon.png")
	if err != nil {
		return err
	}
	src, err := png.Decode(f)
	f.Close()
	if err != nil {
		return err
	}
	mac := image.NewNRGBA(image.Rect(0, 0, 1024, 1024))
	draw.CatmullRom.Scale(mac, image.Rect(100, 100, 924, 924), src, src.Bounds(), draw.Over, nil)
	// Its corners as the template's (radius 185.4 of 824): macOS 26 masks an icon shaped like
	// it into the new shape by itself (WWDC25 220, StarFreedomX, 2026-11-22).
	roundCorners(mac, image.Rect(100, 100, 924, 924), 185.4)
	if err := writePNG("internal/desktop/assets/icon-mac.png", mac); err != nil {
		return err
	}
	var imgs [][]byte
	sizes := []int{16, 20, 24, 32, 40, 48, 64, 128, 256}
	for _, s := range sizes {
		dst := image.NewNRGBA(image.Rect(0, 0, s, s))
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
		var b bytes.Buffer
		if err := png.Encode(&b, dst); err != nil {
			return err
		}
		imgs = append(imgs, b.Bytes())
	}
	for arch, machine := range map[string]uint16{"amd64": 0x8664, "arm64": 0xAA64} {
		reloc := uint16(3) // IMAGE_REL_AMD64_ADDR32NB
		if arch == "arm64" {
			reloc = 2 // IMAGE_REL_ARM64_ADDR32NB
		}
		b := rsrcObject(machine, reloc, sizes, imgs)
		if err := os.WriteFile(fmt.Sprintf("cmd/iridium/rsrc_windows_%s.syso", arch), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// roundCorners keeps of img only what is inside r with its corners rounded by radius, the edge
// smoothed over a pixel.
func roundCorners(img *image.NRGBA, r image.Rectangle, radius float64) {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			cx := math.Max(float64(r.Min.X)+radius, math.Min(px, float64(r.Max.X)-radius))
			cy := math.Max(float64(r.Min.Y)+radius, math.Min(py, float64(r.Max.Y)-radius))
			d := math.Hypot(px-cx, py-cy) - radius // > 0: outside
			cover := math.Max(0, math.Min(1, 0.5-d))
			if cover < 1 {
				i := img.PixOffset(x, y) + 3
				img.Pix[i] = uint8(float64(img.Pix[i]) * cover)
			}
		}
	}
}

func writePNG(path string, img image.Image) error {
	var b bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&b, img); err != nil {
		return err
	}
	return os.WriteFile(path, b.Bytes(), 0o644)
}

// rsrcObject is a COFF object of one .rsrc section: the icons (RT_ICON 1…n) and their group
// (RT_GROUP_ICON 3), the data entries' addresses relocated (ADDR32NB) by the linker.
func rsrcObject(machine, relocType uint16, sizes []int, imgs [][]byte) []byte {
	const (
		rtIcon      = 3
		rtGroupIcon = 14
		lang        = 0x0409
	)
	group := new(bytes.Buffer)
	le := func(w *bytes.Buffer, v any) { _ = binary.Write(w, binary.LittleEndian, v) }
	le(group, [3]uint16{0, 1, uint16(len(imgs))})
	for i, s := range sizes {
		d := uint8(s)
		if s >= 256 {
			d = 0
		}
		le(group, [4]uint8{d, d, 0, 0})
		le(group, [2]uint16{1, 32})
		le(group, uint32(len(imgs[i])))
		le(group, uint16(i+1))
	}

	// The tree: root (types) → names → languages → data entries; then the data.
	type leaf struct {
		typ, id uint32
		data    []byte
	}
	var leaves []leaf
	for i, b := range imgs {
		leaves = append(leaves, leaf{rtIcon, uint32(i + 1), b})
	}
	leaves = append(leaves, leaf{rtGroupIcon, 3, group.Bytes()})

	dirSize := func(n int) int { return 16 + 8*n }
	// Layout: root dir; one name dir per type; one language dir per leaf; data entries; data.
	types := []struct {
		typ    uint32
		leaves []int
	}{{rtIcon, nil}, {rtGroupIcon, nil}}
	for i, l := range leaves {
		for t := range types {
			if types[t].typ == l.typ {
				types[t].leaves = append(types[t].leaves, i)
			}
		}
	}
	off := dirSize(len(types))
	nameDir := make([]int, len(types))
	for t := range types {
		nameDir[t] = off
		off += dirSize(len(types[t].leaves))
	}
	langDir := make([]int, len(leaves))
	for i := range leaves {
		langDir[i] = off
		off += dirSize(1)
	}
	entry := make([]int, len(leaves))
	for i := range leaves {
		entry[i] = off
		off += 16
	}
	dataAt := make([]int, len(leaves))
	for i, l := range leaves {
		off = (off + 7) &^ 7
		dataAt[i] = off
		off += len(l.data)
	}
	sec := make([]byte, (off+7)&^7)
	put32 := func(at int, v uint32) { binary.LittleEndian.PutUint32(sec[at:], v) }
	put16 := func(at int, v uint16) { binary.LittleEndian.PutUint16(sec[at:], v) }
	dir := func(at, ids int) { put16(at+14, uint16(ids)) }
	const sub = 0x80000000
	dir(0, len(types))
	for t, ty := range types {
		put32(16+8*t, ty.typ)
		put32(16+8*t+4, sub|uint32(nameDir[t]))
		dir(nameDir[t], len(ty.leaves))
		for k, i := range ty.leaves {
			at := nameDir[t] + 16 + 8*k
			put32(at, leaves[i].id)
			put32(at+4, sub|uint32(langDir[i]))
		}
	}
	var relocs []int
	for i, l := range leaves {
		dir(langDir[i], 1)
		put32(langDir[i]+16, lang)
		put32(langDir[i]+20, uint32(entry[i]))
		put32(entry[i], uint32(dataAt[i])) // DataRVA: the section's own offset, relocated
		put32(entry[i]+4, uint32(len(l.data)))
		relocs = append(relocs, entry[i])
		copy(sec[dataAt[i]:], l.data)
	}

	var o bytes.Buffer
	const hdr, shdr = 20, 40
	rawAt := hdr + shdr
	relAt := rawAt + len(sec)
	symAt := relAt + 10*len(relocs)
	le(&o, machine)
	le(&o, uint16(1))     // sections
	le(&o, uint32(0))     // time
	le(&o, uint32(symAt)) // symbol table
	le(&o, uint32(1))     // symbols
	le(&o, uint16(0))     // optional header
	le(&o, uint16(0))     // characteristics
	o.WriteString(".rsrc\x00\x00\x00")
	le(&o, uint32(0))           // virtual size
	le(&o, uint32(0))           // virtual address
	le(&o, uint32(len(sec)))    // raw size
	le(&o, uint32(rawAt))       // raw data
	le(&o, uint32(relAt))       // relocations
	le(&o, uint32(0))           // line numbers
	le(&o, uint16(len(relocs))) // relocations
	le(&o, uint16(0))           // line numbers
	le(&o, uint32(0x40000040))  // initialized data, readable
	o.Write(sec)
	for _, at := range relocs {
		le(&o, uint32(at))
		le(&o, uint32(0)) // symbol 0: .rsrc
		le(&o, relocType)
	}
	o.WriteString(".rsrc\x00\x00\x00")
	le(&o, uint32(0)) // value
	le(&o, int16(1))  // section 1
	le(&o, uint16(0)) // type
	le(&o, uint8(3))  // static
	le(&o, uint8(0))  // aux
	le(&o, uint32(4)) // string table: empty
	return o.Bytes()
}
