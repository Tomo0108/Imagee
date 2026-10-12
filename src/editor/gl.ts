import { adjustPixel, type Adjustments } from '../lib/adjust.mjs';

// Mirrors adjustPixel in src/lib/adjust.mjs; keep the two in step.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform float exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation;
in vec2 uv;
out vec4 color;
void main() {
  vec4 texel = texture(image, uv);
  if (texel.a == 0.0) { color = vec4(0.0); return; }
  vec3 c = texel.rgb / texel.a;
  c = pow(c, vec3(2.2));
  float t = temperature / 100.0, n = tint / 100.0, gain = exp2(exposure);
  c *= vec3(1.0 + 0.3 * t, 1.0 - 0.25 * n, 1.0 - 0.3 * t) * gain;
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float tone = highlights / 100.0 * 0.35 * smoothstep(0.45, 1.0, lum) + shadows / 100.0 * 0.35 * (1.0 - smoothstep(0.0, 0.55, lum));
  float black = -blacks / 100.0 * 0.12, white = 1.0 - whites / 100.0 * 0.12;
  vec3 x = clamp((c + tone - black) / (white - black), 0.0, 1.0);
  float k = contrast / 100.0;
  x = k >= 0.0 ? mix(x, x * x * (3.0 - 2.0 * x), k) : mix(x, 0.5 + (x - 0.5) * 0.5, -k);
  float l2 = dot(x, vec3(0.2126, 0.7152, 0.0722));
  float chroma = max(max(x.r, x.g), x.b) - min(min(x.r, x.g), x.b);
  float amount = max(0.0, 1.0 + saturation / 100.0 + vibrance / 100.0 * (1.0 - chroma));
  x = clamp(mix(vec3(l2), x, amount), 0.0, 1.0);
  color = vec4(x * texel.a, texel.a);
}`;
const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = position * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(position, 0.0, 1.0); }`;
const UNIFORMS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'vibrance', 'saturation'] as const;

/** Applies adjustments to a source image. Uses WebGL2 when available and falls back to the CPU reference. */
export class Adjuster {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private texture: WebGLTexture | null = null;
  private source: CanvasImageSource | null = null;
  private sourceData: ImageData | null = null;
  readonly maxSize: number;

  constructor() {
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    this.maxSize = this.gl ? Math.min(8192, this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) : 4096;
    if (this.gl && !this.init(this.gl)) this.gl = null;
  }

  get accelerated() { return !!this.gl; }

  private init(gl: WebGL2RenderingContext) {
    const compile = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null; };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    this.program = program;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.locations.set(name, gl.getUniformLocation(program, name));
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    return true;
  }

  /** Sets the image to adjust; its size must not exceed `maxSize`. */
  setSource(source: HTMLCanvasElement | ImageBitmap) {
    this.source = source;
    this.canvas.width = source.width; this.canvas.height = source.height;
    const gl = this.gl;
    if (gl) {
      gl.viewport(0, 0, source.width, source.height);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
      context.clearRect(0, 0, source.width, source.height);
      context.drawImage(source, 0, 0);
      this.sourceData = context.getImageData(0, 0, source.width, source.height);
    }
  }

  render(adjustments: Adjustments): HTMLCanvasElement {
    const gl = this.gl;
    if (gl) {
      for (const name of UNIFORMS) gl.uniform1f(this.locations.get(name)!, adjustments[name]);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.sourceData && this.source) {
      const out = new ImageData(new Uint8ClampedArray(this.sourceData.data), this.sourceData.width, this.sourceData.height);
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const [r, g, b] = adjustPixel([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], adjustments);
        d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
      }
      this.canvas.getContext('2d')!.putImageData(out, 0, 0);
    }
    return this.canvas;
  }
}
