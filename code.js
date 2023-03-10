"use strict";
let zoomLevel = 1.0;
let padding = 48; //24
let interval;
var TransitionType;
(function (TransitionType) {
    TransitionType[TransitionType["Stop"] = 0] = "Stop";
    TransitionType[TransitionType["Passthrough"] = 1] = "Passthrough";
    TransitionType[TransitionType["Instant"] = 2] = "Instant";
})(TransitionType || (TransitionType = {}));
function init() {
    let compact = true;
    figma.showUI(__html__, { visible: true, themeColors: true, width: 70, height: 40 });
    figma.ui.onmessage = msg => {
        if (msg.type === 'menu') {
            if (compact) {
                figma.ui.resize(140, 200);
            }
            else {
                figma.ui.resize(70, 40);
            }
            compact = !compact;
            return;
        }
        ;
        handleMessage(msg);
    };
    figma.on("currentpagechange", loadFrames);
    loadFrames();
}
let cameraPath;
let cameraFrames;
let currentFrame = undefined; //frames[0];
let currentIndex = -1;
let currentLength;
function loadFrames() {
    figma.skipInvisibleInstanceChildren = true;
    cameraPath = figma.currentPage.findChildren(node => {
        return node.type === "VECTOR" && (node.name.toLowerCase() == "journey" || node.name.toLowerCase() == "camera");
    }).pop();
    let framesInfo = [];
    function traverse(node) {
        for (const child of node.children) {
            if (child.type == "FRAME") {
                framesInfo.push({ node: child, rect: child.absoluteBoundingBox });
            }
            else if (child.type == "SECTION") {
                traverse(child);
            }
        }
    }
    traverse(figma.currentPage);
    function sortFrames(a, b) {
        if (Math.abs(a.rect.y - b.rect.y) < Math.max(a.rect.height, b.rect.height) / 2) {
            return (a.rect.x - b.rect.x);
        }
        return (a.rect.y - b.rect.y);
    }
    framesInfo.sort(sortFrames);
    cameraFrames = framesInfo.map(info => info.node);
    currentIndex = -1;
    currentFrame = undefined;
    console.log("Loaded Frames", cameraFrames, cameraPath);
}
function handleMessage(msg) {
    var _a, _b;
    let transitionType = TransitionType.Stop;
    currentLength = cameraPath ? cameraPath.vectorNetwork.vertices.length : cameraFrames.length;
    let duration = msg.event.shift == true ? 2000 : 667;
    let reverse = msg.type === 'prev';
    if (cameraPath != null) {
        let segment = undefined;
        if (reverse) {
            segment = cameraPath.vectorNetwork.segments.find(segment => segment.end === currentIndex);
            if (segment)
                currentIndex = segment.start;
        }
        else {
            segment = cameraPath.vectorNetwork.segments.find(segment => segment.start === currentIndex);
            if (segment)
                currentIndex = segment.end;
        }
        if (currentIndex < 0)
            currentIndex = 0;
        if (currentIndex >= currentLength) {
            currentIndex = -1;
            return;
        }
        let vertex = cameraPath.vectorNetwork.vertices[currentIndex];
        let ox = ((_a = cameraPath.absoluteBoundingBox) === null || _a === void 0 ? void 0 : _a.x) || 0;
        let oy = ((_b = cameraPath.absoluteBoundingBox) === null || _b === void 0 ? void 0 : _b.y) || 0;
        let x = vertex.x + ox;
        let y = vertex.y + oy;
        let rect = { x, y };
        const frame = figma.currentPage
            .findChildren(node => node.type === "FRAME" && pointInRect({ x, y }, node.absoluteBoundingBox))
            .pop();
        if (segment) {
            let nextIndex = reverse ? segment.end : segment.start;
            let vertexEnd = cameraPath.vectorNetwork.vertices[nextIndex];
            let offset = { x: vertex.x - vertexEnd.x, y: vertex.y - vertexEnd.y };
            let types = { "MITER": TransitionType.Stop, "ROUND": TransitionType.Passthrough, "BEVEL": TransitionType.Instant };
            transitionType = types[vertex.strokeJoin || "MITER"];
            let startCenter = figma.viewport.center;
            let scale;
            if (frame) {
                let frameBox = frame.absoluteBoundingBox;
                if (frameBox) {
                    let endCenter = { x: frameBox.x + (frameBox.width || 0) / 2, y: frameBox.y + (frameBox.height || 0) / 2 };
                    scale = {
                        x: offset.x ? (endCenter.x - startCenter.x) / offset.x : 1,
                        y: offset.y ? (endCenter.y - startCenter.y) / offset.y : 1
                    };
                }
            }
            if (reverse) {
                if (segment.tangentStart)
                    rect.tangentEnd = { x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0 };
                if (segment.tangentEnd)
                    rect.tangentStart = { x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0 };
            }
            else {
                if (segment.tangentStart)
                    rect.tangentStart = { x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0 };
                if (segment.tangentEnd)
                    rect.tangentEnd = { x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0 };
            }
            if (scale) {
                rect.tangentStart.x *= scale.x;
                rect.tangentStart.y *= scale.y;
                rect.tangentEnd.x *= scale.x;
                rect.tangentEnd.y *= scale.y;
            }
        }
        if (frame) {
            rect = Object.assign(rect, frame.absoluteBoundingBox);
        }
        if (transitionType == TransitionType.Instant)
            duration = 0;
        animateToRect(rect, duration);
        if (transitionType == TransitionType.Passthrough) {
            setTimeout(() => {
                delete msg.event.time;
                handleMessage(msg);
            }, duration);
        }
    }
    else {
        if (msg.type === 'next') {
            currentIndex++;
        }
        else if (msg.type === 'prev') {
            currentIndex--;
        }
        if (currentIndex < 0)
            currentIndex = currentLength - 1;
        if (currentIndex >= currentLength) {
            currentIndex = -1;
            return;
        }
        currentFrame = cameraFrames[currentIndex];
        if (currentFrame.name.endsWith("???"))
            duration = 0;
        animateToRect(currentFrame.absoluteBoundingBox, duration);
    }
}
;
function pointInRect(p, rect) {
    if (!rect)
        return false;
    return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}
function animateToRect(rect, duration) {
    if (interval != null) {
        // duration = 0.0;
        clearInterval(interval);
    }
    let startCenter = figma.viewport.center;
    let endCenter = { x: rect.x + (rect.width || 0) / 2, y: rect.y + (rect.height || 0) / 2 };
    console.log("Animating to Rect", rect);
    let bez = rect.tangentStart
        ? bezier([
            [startCenter.x, startCenter.y],
            [startCenter.x + rect.tangentStart.x, startCenter.y + rect.tangentStart.y],
            [endCenter.x + rect.tangentEnd.x, endCenter.y + rect.tangentEnd.y],
            [endCenter.x, endCenter.y]
        ])
        : bezier([
            [startCenter.x, startCenter.y],
            [endCenter.x, endCenter.y]
        ]);
    let distance = Math.sqrt(Math.pow(endCenter.x - startCenter.x, 2) + Math.pow(endCenter.y - startCenter.y, 2));
    // duration = Math.max(200, Math.min(1000, duration * distance / 1000));
    let startZoom = figma.viewport.zoom;
    let endZoom = Math.min((figma.viewport.bounds.width * figma.viewport.zoom - padding * 2) / rect.width, (figma.viewport.bounds.height * figma.viewport.zoom - padding * 2) / rect.height) * zoomLevel;
    if (!endZoom)
        endZoom = startZoom;
    // Zoom uses an easing function that biases towards the lower (zoomed out) level.
    // This prevents fast movements at high zoom.
    let minZoom = Math.min(startZoom, endZoom);
    let overviewZoom = minZoom / 2;
    let extraScale = 0.95;
    let zoomFunc = bezier([
        [startZoom],
        [minZoom * extraScale],
        [minZoom * extraScale],
        [endZoom]
    ]);
    let start = Date.now();
    let end = start + duration;
    interval = setInterval(function () {
        let now = Date.now();
        let t = Math.min(1, Math.max(0, (now - start) / (end - start)));
        let progress = 0.5 - 0.5 * Math.cos(t * Math.PI);
        figma.viewport.center = {
            x: startCenter.x + (endCenter.x - startCenter.x) * progress,
            y: startCenter.y + (endCenter.y - startCenter.y) * progress
        };
        if (bez) {
            let [x, y] = bez(progress);
            // console.log("BEZ", x,y,progress)
            try {
                figma.viewport.center = { x: x || 0, y: y || 0 };
            }
            catch (e) {
                console.error("ERROR", e);
            }
        }
        // Zoom out slightly at beginning and end of animation
        let lift = Math.min(0.025, 1.0 - Math.abs(progress - 0.5)); // (Math.cos((progress - 0.5) * 2 * Math.PI) + 1)/2;
        lift = 1.0 - lift;
        let zoom = zoomFunc(progress)[0];
        figma.viewport.zoom = zoomFunc(progress)[0]; // * lift;
        if (now >= end) {
            if (interval != null) {
                clearInterval(interval);
                interval = null;
            }
        }
    }, 1000 / 30);
}
function lerp(start, end, p, f) {
    if (!f)
        f = (v) => v;
    return start + (end - start) * f(p);
}
/**
 * Given an array of control points, returns a function that computes the point on the bezier curve for a given parameter t.
 * @param pts An array of control points, where each control point is an array of numbers representing its coordinates.
 * @returns A function that takes a parameter t between 0 and 1, and returns an array of numbers representing the point on the bezier curve at that parameter.
 */
function bezier(pts) {
    console.info("Creating Bezier", pts);
    return function (t) {
        // Initialize the current set of points to the input control points.
        let a = pts;
        let b;
        for (; a.length > 1; a = b) { // Repeatedly compute the next set of points until there is only one left.
            b = [];
            for (let i = 0, j; i < a.length - 1; i++) { // Compute each new point as an interpolation between adjacent points in the current set.
                b[i] = [];
                for (j = 0; j < a[i].length; j++) { // Compute the coordinates of the new point by interpolating between the adjacent points.
                    b[i][j] = a[i][j] * (1 - t) + a[i + 1][j] * t;
                }
            }
        }
        return a[0]; // Return the final point on the bezier curve.
    };
}
init();
