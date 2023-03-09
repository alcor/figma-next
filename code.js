"use strict";

let zoomLevel = 1.0;
let padding = 48;  //24
let interval;

function init() {
  const journey = figma.currentPage.findChildren(node => { 
    return node.type === "VECTOR" && (node.name.toLowerCase() == "journey" || node.name.toLowerCase() == "camera") 
  }).pop();

  figma.skipInvisibleInstanceChildren = true
  
  let framesInfo = [];
  function traverse(node) {
    for (const child of node.children) {
      if (child.type == "FRAME") {
        framesInfo.push({node:child, rect:child.absoluteBoundingBox})
      } else if (child.type == "SECTION") {
        traverse(child)
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
  
  let frames = framesInfo.map(info => info.node);
  let currentFrame = undefined; //frames[0];
  let currentIndex = -1;
  let currentLength = journey ? journey.vectorNetwork.vertices.length : frames.length;


  figma.showUI(__html__, { visible: true, themeColors: true, width: 70, height: 40 });
  let compact = true;
  figma.ui.onmessage = msg => {
    
    if (msg.type === 'menu') {
      if (compact) {
      figma.ui.resize(140, 200);
      } else {
        figma.ui.resize(70, 40);
      }
      compact = !compact;
      return;
    };


    if (journey) {

      let segment = undefined;
      let back = msg.type === 'prev';
      if (msg.type === 'next') {
        segment = journey.vectorNetwork.segments.find(segment => segment.start === currentIndex);
        if (segment) currentIndex = segment.end
      } else if (msg.type === 'prev') {
        segment = journey.vectorNetwork.segments.find(segment => segment.end === currentIndex);
        if (segment) currentIndex = segment.start
      }
      if (currentIndex < 0) currentIndex = 0;

      let vertex = journey.vectorNetwork.vertices[currentIndex];
      
      let ox = journey.absoluteBoundingBox.x;
      let oy = journey.absoluteBoundingBox.y;
      let x = vertex.x + ox;
      let y = vertex.y + oy;

      let rect = {x, y};
      const frame = figma.currentPage
        .findChildren(node => node.type === "FRAME" && pointInRect(x, y, node.absoluteBoundingBox))
        .pop();


      if (segment) {
        let nextIndex = back ? segment.end : segment.start
        let vertexEnd = journey.vectorNetwork.vertices[nextIndex]
        let offset = {x: vertex.x - vertexEnd.x, y: vertex.y - vertexEnd.y};


        let startCenter = figma.viewport.center;

        let scale; 
        if (frame) {
          let frameBox = frame.absoluteBoundingBox;
          let endCenter = {x: frameBox.x + (frameBox.width || 0) / 2, y: frameBox.y + (frameBox.height || 0) / 2}
          scale = {
            x:(endCenter.x - startCenter.x) / offset.x , 
            y: (endCenter.y - startCenter.y) / offset.y
        }
        }

        if (back) {
          rect.tangentEnd = {x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0}
          rect.tangentStart = {x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0}
        } else {
          rect.tangentStart = {x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0}
          rect.tangentEnd = {x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0}
        }


        if (scale) {
          rect.tangentStart.x *= scale.x
          rect.tangentStart.y *= scale.y
          rect.tangentEnd.x *= scale.x
          rect.tangentEnd.y *= scale.y
        }
      }

      if (frame) rect = Object.assign(rect, frame.absoluteBoundingBox);
        
      animateToRect(rect, msg.event.shift ? 2000 : 667);  

    } else {
      if (msg.type === 'next') {
        currentIndex++;
      } else if (msg.type === 'prev') {
        currentIndex--;
      }
      
      if (currentIndex < 0) currentIndex = currentLength - 1;
      if (currentIndex >= currentLength) currentIndex = 0;

      currentFrame = frames[currentIndex];
      animateToRect(currentFrame.absoluteBoundingBox, msg.event.shift ? 2000 : 667);  
    }
  };
  
}


function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}


function animateToRect(rect, duration) {
  if (interval) duration = 0.0;

  clearInterval(interval);
  let startCenter = figma.viewport.center;
  let endCenter = {x: rect.x + (rect.width || 0) / 2, y: rect.y + (rect.height || 0) / 2}
  
  console.log("Animating to Rect", rect);
  let bez = rect.tangentStart 
    ? bezier([
        [startCenter.x, startCenter.y],
        [startCenter.x + rect.tangentStart.x, startCenter.y + rect.tangentStart.y],
        [endCenter.x + rect.tangentEnd.x, endCenter.y + rect.tangentEnd.y],
        [endCenter.x, endCenter.y]]) 
    : bezier([
        [startCenter.x, startCenter.y],
        [endCenter.x, endCenter.y]])

  let distance = Math.sqrt(Math.pow(endCenter.x - startCenter.x, 2) + Math.pow(endCenter.y - startCenter.y, 2));

  // duration = Math.max(200, Math.min(1000, duration * distance / 1000));
  let startZoom = figma.viewport.zoom;
  let endZoom = Math.min(
    (figma.viewport.bounds.width * figma.viewport.zoom - padding * 2) / rect.width,
    (figma.viewport.bounds.height * figma.viewport.zoom - padding * 2) / rect.height
  ) * zoomLevel;
  if (!endZoom) endZoom = startZoom;
  
  // Zoom uses an easing function that biases towards the lower (zoomed out) level.
  // This prevents fast movements at high zoom.
  let minZoom = Math.min(startZoom, endZoom);
  let overviewZoom = minZoom/2;
  let extraScale = 0.95
  let zoomFunc = bezier([
    [startZoom],
    [minZoom * extraScale], 
    [minZoom * extraScale], 
    [endZoom]
  ]);

  let start = Date.now();
  let end = start + duration;
  interval = setInterval(function() {
    let now = Date.now();
    let t = Math.min(1, Math.max(0, (now - start) / (end - start)));
    let progress = 0.5 - 0.5 * Math.cos(t * Math.PI);
    figma.viewport.center = {
      x: startCenter.x + (endCenter.x - startCenter.x) * progress,
      y: startCenter.y + (endCenter.y - startCenter.y) * progress
    };

    if (bez) {
      let [x, y] = bez(progress);
      figma.viewport.center = {x:x, y:y};
    }
    
    // Zoom out slightly at beginning and end of animation
    let lift = Math.min(0.025, 1.0 - Math.abs(progress - 0.5)); // (Math.cos((progress - 0.5) * 2 * Math.PI) + 1)/2;
    lift = 1.0 - lift;

    let zoom = zoomFunc(progress)[0];
    figma.viewport.zoom = zoomFunc(progress)[0];// * lift;
    

    if (now >= end) {
      clearInterval(interval);
      interval = null;
    }
  }, 1000 / 30);
}



function lerp(start, end, p, f) {
  if (!f) f = (v) => v;
  return start + (end - start) * f(p);
}

function bezier(pts, debug) {
  return function (t) {
    for (var a = pts; a.length > 1; a = b)  // do..while loop in disguise
      for (var i = 0, b = [], j; i < a.length - 1; i++)  // cycle over control points
        for (b[i] = [], j = 0; j < a[i].length; j++){  // cycle over dimensions
          b[i][j] = a[i][j] * (1 - t) + a[i+1][j] * t;  // interpolation
        }
    return a[0];
  }
}


init();