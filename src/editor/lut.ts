import { sampleBaked } from '../lib/color.mjs';
import { canvas } from '../imaging';
import type { Box } from './pixels';

export interface BakedLut { table: Uint8Array; size: number }

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = position * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(position, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D image;
uniform sampler3D lut;
uniform float size;
in vec2 uv;
out vec4 color;
void main() {
  vec4 texel = texture(image, uv);
  if (texel.a == 0.0) { color = vec4(0.0); return; }
  vec3 c = clamp(texel.rgb / texel.a, 0.0, 1.0);
  vec3 graded = texture(lut, c * ((size - 1.0) / size) + 0.5 / size).rgb;
  color = vec4(graded * texel.a, texel.a);
}`;

/** Uploads a baked table as a 3D texture on the given unit. Shared with the global adjuster. */
export function uploadLut(gl: WebGL2RenderingContext, texture: WebGLTexture, lut: BakedLut) {
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.table);
  for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, key, value);
}

/** Applies a colour table to part of a canvas: what adjustment layers do to the layers below them. */
class LutPass {
  private output = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null;
  private image: WebGLTexture | null = null;
  private lut: WebGLTexture | null = null;
  private sizeLocation: WebGLUniformLocation | null = null;
  private uploaded: Uint8Array | null = null;
  private staging = canvas(1, 1);

  constructor() {
    this.gl = this.output.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (this.gl && !this.init(this.gl)) this.gl = null;
  }

  private init(gl: WebGL2RenderingContext) {
    const compile = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null; };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'lut'), 1);
    this.sizeLocation = gl.getUniformLocation(program, 'size');
    this.image = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    this.lut = gl.createTexture();
    return true;
  }

  /** Returns a canvas the size of `box` holding the graded pixels of `source` in that box. */
  apply(source: HTMLCanvasElement, box: Box, lut: BakedLut): HTMLCanvasElement {
    const gl = this.gl;
    const staging = this.staging;
    staging.width = box.w; staging.height = box.h;
    const s = staging.getContext('2d', { willReadFrequently: !gl })!;
    s.clearRect(0, 0, box.w, box.h);
    s.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    if (!gl) {
      const data = s.getImageData(0, 0, box.w, box.h), d = data.data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) sampleBaked(lut.table, lut.size, d[i], d[i + 1], d[i + 2], d, i);
      s.putImageData(data, 0, 0);
      return staging;
    }
    this.output.width = box.w; this.output.height = box.h;
    gl.viewport(0, 0, box.w, box.h);
    gl.activeTexture(gl.TEXTURE1);
    if (this.uploaded !== lut.table) { uploadLut(gl, this.lut!, lut); this.uploaded = lut.table; } else gl.bindTexture(gl.TEXTURE_3D, this.lut);
    gl.uniform1f(this.sizeLocation, lut.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, staging);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.output;
  }
}

let pass: LutPass | null = null;
export function lutPass() { return pass ||= new LutPass(); }
