// Adapted for Flutter from SilentEaves/LiquidGlass-Cpp (Shaders.cpp):
// Copyright 2026 默檐; Copyright 2025 Kyant. SPDX-License-Identifier: Apache-2.0
// Convex surface / Snell displacement adapted from mkj0kjay/vue-web-liquid-glass
// (src/lib/surfaceEquations.ts, displacementMap.ts), MIT.
// Flutter changes: single rounded surface, bounded samples, no OpenGL/ImGui
// dependency, premultiplied alpha, and engine-provided backdrop texture.
#include <flutter/runtime_effect.glsl>

uniform vec2 uSize; // ImageFilter.shader sets the first vec2 and sampler.
uniform float uRadius;
uniform float uBezel;
uniform float uLensAmount;
uniform float uRefraction;
uniform float uSpectral;
uniform vec4 uTint;
uniform sampler2D uScene;
out vec4 fragColor;

// LiquidGlass-Cpp rounded-box field and edge normal.
float boxMetric(vec2 p, vec2 semi, float r) {
  vec2 q = abs(p) - semi + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}
vec2 boxNormal(vec2 p, vec2 semi, float r) {
  vec2 q = abs(p) - semi + vec2(r);
  vec2 over = max(q, vec2(0.0));
  float len2 = dot(over, over);
  vec2 arc = len2 > 1.0e-8 ? over * inversesqrt(len2) : vec2(0.0);
  float horiz = step(q.y, q.x);
  vec2 axis = vec2(horiz, 1.0 - horiz);
  return mix(axis, arc, step(0.0, max(q.x, q.y))) * sign(p);
}
float lensCurve(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * tan(asin(t) * 0.5);
}

// Vue CONVEX squircle and calculateDisplacementMap refraction. Evaluate the
// derivative analytically instead of allocating an SVG displacement bitmap.
float convexDisplacement(float x) {
  float t = clamp(x, 0.001, 0.999);
  float a = 1.0 - t;
  float a2 = a * a;
  float h = max(1.0 - a2 * a2, 0.00001);
  float height = pow(h, 0.25);
  float derivative = a2 * a / pow(h, 0.75);
  vec2 normal = normalize(vec2(-derivative, -1.0));
  vec2 ray = refract(vec2(0.0, 1.0), normal, 1.0 / uRefraction);
  return ray.x * (height * uBezel + uLensAmount) / max(ray.y, 0.001);
}
vec4 scene(vec2 p) {
  vec2 uv = clamp(p, vec2(0.5), max(uSize - vec2(0.5), vec2(0.5))) / max(uSize, vec2(1.0));
#ifdef IMPELLER_TARGET_OPENGLES
  uv.y = 1.0 - uv.y;
#endif
  return texture(uScene, uv);
}
void main() {
  vec2 p = FlutterFragCoord().xy;
  vec2 halfSize = uSize * 0.5;
  float radius = min(uRadius, min(halfSize.x, halfSize.y));
  float d = boxMetric(p - halfSize, halfSize, radius);
  float depth = max(-d, 0.0);
  float t = clamp(depth / max(uBezel, 1.0), 0.0, 1.0);
  vec2 normal = boxNormal(p - halfSize, halfSize, radius);
  float shift = mix(convexDisplacement(t), lensCurve(1.0 - t) * uLensAmount, 0.6);
  shift *= 1.0 - smoothstep(0.85, 1.0, t);
  vec2 displacement = -normal * min(shift, uLensAmount * 1.5);
  vec4 center = scene(p + displacement);
  // C++ spectral sampling, reduced to three bounded samples for mobile.
  vec4 red = scene(p + displacement * (1.0 + uSpectral));
  vec4 blue = scene(p + displacement * (1.0 - uSpectral));
  vec3 rgb = min(vec3(red.r, center.g, blue.b), vec3(center.a));
  float alpha = center.a + uTint.a * (1.0 - center.a);
  rgb = rgb * (1.0 - uTint.a) + uTint.rgb * uTint.a;
  // Directional opposing rims, following both repositories' specular models.
  float direction = abs(dot(normal, normalize(vec2(-0.5, -0.866))));
  float rim = exp(-depth / max(uBezel * 0.10, 0.7));
  rgb += vec3(pow(direction, 3.0) * rim * 0.22) * alpha;
  float mask = 1.0 - smoothstep(-0.5, 0.5, d);
  fragColor = vec4(clamp(rgb, vec3(0.0), vec3(alpha)), alpha) * mask;
}
