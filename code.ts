let zoomLevel = 1.0;
let padding = 48;  //24
let interval: number | null;

enum TransitionType {
  Stop,
  Passthrough,
  Instant
}
enum Direction {
  Prev = -3,
  Left = -2,
  Up = -1,
  Stop = 0,
  Down = 1,
  Right = 2,
  Next = 3
}

let DirectionMap: {[k: string]: string} = {
  "1": "BOTTOM",
  "-1": "TOP",
  "2": "RIGHT",
  "-2": "LEFT"
}

interface Keyframe { 
  node?: SceneNode;
  x: any; y: any; 
  width?: any; height?: any; 
  tangentStart?: any; tangentEnd?: any;
  vnext?: Keyframe; vprev?: Keyframe; 
  hnext?: Keyframe; hprev?: Keyframe;
  connections?: {[k: string]: Keyframe};
  hindex?:number;
  children?: Keyframe[];
}

let figjam = figma.editorType === "figjam";
let zoomModifier = 1.0
let baseSpeed = 600

function init() {
  let compact = true;
  figma.showUI(__html__, { visible: true, themeColors: true, width: 72, height: 36 });
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
    handleMessage(msg);
  }

  figma.on("currentpagechange", loadFrames)

  loadFrames();
}
  
let cameraPath: VectorNode;
let keyframes: Keyframe[];

let currentKeyframe: Keyframe | undefined = undefined; //frames[0];
let currentIndex = -1;
let currentLength;

figma.on("selectionchange", () => { 
  let selection = figma.currentPage.selection[0];

  if (selection) {
    while (selection.parent.type != "PAGE"  && selection.parent.type != "SECTION") {
      console.log("selection", selection.parent, selection.parent?.type)
      if (selection.parent) selection = selection.parent as SceneNode;
    }
  }

  keyframes.forEach(keyframe => {
    if (selection === keyframe.node) {
      currentKeyframe = keyframe;
      if (cameraPath) {      
        let ox = cameraPath.absoluteBoundingBox?.x || 0;
        let oy = cameraPath.absoluteBoundingBox?.y || 0;
        cameraPath.vectorNetwork.vertices.forEach((vertex, i) => {
          let x = vertex.x + ox;
          let y = vertex.y + oy;
          if (pointInRect({x, y}, selection.absoluteBoundingBox)) {
            currentIndex = i;
          }

        })
      } else {
        currentIndex = keyframes.indexOf(keyframe);
      }
      console.log("Selecting index: ", currentIndex, keyframe)
      return true;
    }
  })
})

function loadFrames() {
  figma.skipInvisibleInstanceChildren = true
  
  cameraPath = (figma.currentPage.findChildren(node => { 
    return node.type === "VECTOR" && (node.name.toLowerCase() == "journey" || node.name.toLowerCase() == "camera") 
  }).pop() as VectorNode);


  let framesInfo: Keyframe[] = [];
  let connectors: ConnectorNode[] = [];
  let sections: SectionNode[] = [];

  function sortFramesHorizontally(a: Keyframe, b: Keyframe) {
    if (Math.abs(a.y - b.y) < Math.max(a.height, b.height) / 2) return (a.x - b.x);
    return (a.y - b.y);
  }
  function sortFramesVertically(a: Keyframe, b: Keyframe) {
    if (Math.abs(a.x - b.x) < Math.max(a.width, b.width) / 2) return (a.y - b.y);
    return (a.x - b.x);
  }

  function traverse(node: PageNode | SectionNode) {
    let childFrames: Keyframe[] = [];
    for (const child of node.children) {
      let type = child.type;
      let info = {...child.absoluteBoundingBox} as Keyframe;
      info.node = child;
      switch(child.type) {
        case "FRAME":
        case "SHAPE_WITH_TEXT":
        case "STICKY":
        case "TABLE":
        case "LINK_UNFURL":
        case "INSTANCE":
        case "WIDGET":
        case "FRAME":
          childFrames.push(info);
          break
        case "SECTION":
          info.children = traverse(child as SectionNode);
          if (figjam) {
            childFrames.push(info);
          };
          sections.push(child as SectionNode)
          break
        case "CONNECTOR":
          connectors.push(child as ConnectorNode)
          break
        case "VECTOR":
            // if (figjam) cameraPath = child as VectorNode;
            break
        default:
          console.log("Unknown Type", type, child)
        }
    }  
    return childFrames;
  }
  
  framesInfo = traverse(figma.currentPage);
  console.log("connectors", connectors, sections, framesInfo, figma.currentPage)
  
  function sortAndFlatten(frames: Keyframe[], sortFn: (a: Keyframe, b: Keyframe) => number) {
    let children: Keyframe[] = []; 
    frames.sort(sortFn);
    frames.forEach(frame => {
      children.push(frame);
      if (frame.children) {
        children = children.concat(sortAndFlatten(frame.children, sortFn));
      }
    })
    return children;
  }

  let framesById: {[k: string]: Keyframe} = {}
  let vertFrames = sortAndFlatten(framesInfo, sortFramesVertically);
  for (let i = 0; i < vertFrames.length; i++) {
    let info = vertFrames[i];
    let id = info.node?.id;
    if (id) framesById[id] = info;
    let next = vertFrames[i + 1];
    if (next) {
      info.vnext = next;
      next.vprev = info;
    }
  }

  let horizFrames = sortAndFlatten(framesInfo, sortFramesHorizontally);
  for (let i = 0; i < horizFrames.length; i++) {
    let info = horizFrames[i];
    let next = horizFrames[i + 1];
    if (next) {
      info.hnext = next;
      next.hprev = info;
      info.hindex = i;
    }

    info.connections = {};
    interface Directions {[k: string]: Keyframe;}
    
    // let connections = info.node?.attachedConnectors.forEach(connector => {
    //   let endpoint = connector.connectorStart as ConnectorEndpointEndpointNodeIdAndMagnet;
    //   if (endpoint.endpointNodeId == info.node?.id) {
    //     let id = (connector.connectorEnd as ConnectorEndpointEndpointNodeIdAndMagnet).endpointNodeId;
    //     if (info.connections) info.connections[endpoint.magnet as string] = framesById[id];
    //   }

    //   endpoint = connector.connectorEnd as ConnectorEndpointEndpointNodeIdAndMagnet;
    //   if (endpoint.endpointNodeId == info.node?.id) {
    //     let id =  (connector.connectorStart as ConnectorEndpointEndpointNodeIdAndMagnet).endpointNodeId;
    //     if (info.connections) info.connections[endpoint.magnet as string] = framesById[id];
    //   }
    // })
    
    // if (info.connections.length) console.log("connections", info.connections)
    // let currentNodeInfo = currentKeyframe?.node;
    // if (currentNodeInfo) {
    // let nextNodeConnector = currentNodeInfo?.attachedConnectors?.find(connector => {
    //   let endpoint = connector.connectorStart as ConnectorEndpointEndpointNodeIdAndMagnet;
    //   return endpoint.endpointNodeId == currentNodeInfo?.id 
    //   && endpoint.magnet == "RIGHT";
    // });
  }

  keyframes = horizFrames;

  currentIndex = -1
  currentKeyframe = undefined;

  let description = (keyframes.length.toString() + " frames");
  if (cameraPath) description = cameraPath.vectorNetwork.vertices.length.toString() + " points";
  console.log("Loaded Frames", keyframes, cameraPath)

  figma.currentPage.setPluginData("speed", baseSpeed.toString());
  baseSpeed = parseInt(figma.currentPage.getPluginData("speed")) || 600
  console.log("base speed", baseSpeed)
  figma.currentPage.setRelaunchData({ 
    show: description
  });

}


function handleMessage(msg: { type: string; event: {alt: boolean, ctrl: boolean, shift: boolean, time?:number}, direction?:number }) {
  console.log("\nFrom UI:", msg)
  if (msg.type == 'zoom' && msg.direction) { 
    let oldZoomModifier = zoomModifier;
    zoomModifier = Math.max(0.2, zoomModifier + msg.direction * 0.05)
    console.log("Set Zoom:", zoomModifier)
    figma.viewport.zoom *= zoomModifier / oldZoomModifier;// * lift;
    figma.currentPage.setPluginData("zoom", zoomModifier.toString());
    return;
  }

  if (msg.type == 'axis') { 
    console.log("zoom", msg)
    return;
  }
  
  if (msg.type == 'speed' && msg.direction != undefined) { 
    let speeds = [0, 999, 888, 777, 666, 555, 444, 333, 222, 111]
    baseSpeed = speeds[msg.direction];
    figma.currentPage.setPluginData("speed", baseSpeed.toString());
    console.log("set speed ",baseSpeed.toString())
    return;
  }
  
  
  let transitionType = TransitionType.Stop;
  currentLength = cameraPath ? cameraPath.vectorNetwork.vertices.length : keyframes.length;

  let duration = msg.event.shift == true ? 2000 : baseSpeed;

  let direction = msg.direction as Direction || Direction.Stop
  let vertical = direction == Direction.Up || direction == Direction.Down
  let reverse = (msg.direction || 0) < 0

  figma.currentPage.selection = [];

  if (cameraPath != null) {

    let segment = undefined;
    if (reverse) {
      segment = cameraPath.vectorNetwork.segments.find(segment => segment.end === currentIndex);
      if (segment) currentIndex = segment.start
    } else {
      segment = cameraPath.vectorNetwork.segments.find(segment => segment.start === currentIndex);
      if (segment) currentIndex = segment.end
    } 

    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= currentLength) {
      currentIndex = -1;
      return;
    } else {
    }

    console.log("New Index:", currentIndex)
    let vertex = cameraPath.vectorNetwork.vertices[currentIndex];
    
    let ox = cameraPath.absoluteBoundingBox?.x || 0;
    let oy = cameraPath.absoluteBoundingBox?.y || 0;
    let x = vertex.x + ox;
    let y = vertex.y + oy;

    let rect:Keyframe = {x, y};
    const frame = figma.currentPage
      .findChildren(node => node.type === "FRAME" && pointInRect({x, y}, node.absoluteBoundingBox))
      .pop();


    if (segment) {
      let nextIndex = reverse ? segment.end : segment.start
      let vertexEnd = cameraPath.vectorNetwork.vertices[nextIndex]
      let offset = {x: vertex.x - vertexEnd.x, y: vertex.y - vertexEnd.y};

      let types = {"MITER":TransitionType.Stop, "ROUND":TransitionType.Passthrough, "BEVEL":TransitionType.Instant};
      transitionType = types[vertex.strokeJoin || "MITER"]

      if (figjam) transitionType = TransitionType.Stop;
      
      let startCenter = figma.viewport.center;

      let scale; 
      if (frame) {
        let frameBox = frame.absoluteBoundingBox;
        if (frameBox) {
          let endCenter = {x: frameBox.x + (frameBox.width || 0) / 2, y: frameBox.y + (frameBox.height || 0) / 2}
          scale = {
            x: offset.x ? (endCenter.x - startCenter.x) / offset.x : 1, 
            y: offset.y ? (endCenter.y - startCenter.y) / offset.y : 1
          }
        }
      }

      if (reverse) {
        if (segment.tangentStart) rect.tangentEnd = {x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0}
        if (segment.tangentEnd) rect.tangentStart = {x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0}
      } else {
         if (segment.tangentStart) rect.tangentStart = {x: segment.tangentStart.x || 0, y: segment.tangentStart.y || 0}
        if (segment.tangentEnd) rect.tangentEnd = {x: segment.tangentEnd.x || 0, y: segment.tangentEnd.y || 0}
      }


      if (scale) {
        rect.tangentStart.x *= scale.x
        rect.tangentStart.y *= scale.y
        rect.tangentEnd.x *= scale.x
        rect.tangentEnd.y *= scale.y
      }
    }

    if (frame) {
      rect = Object.assign(rect, frame.absoluteBoundingBox);
    }


    if (transitionType == TransitionType.Instant) duration = 0;
    animateToRect(rect, duration);  

    if (transitionType == TransitionType.Passthrough) {
      setTimeout(() => {
        delete msg.event.time;
        handleMessage(msg)
  
      }, duration)
    }

  } else {
    let prevNode: any = currentKeyframe;
    
    let nextKeyframe: Keyframe | undefined;

    let magnet = DirectionMap[direction as unknown as string];
    let currentNodeInfo = currentKeyframe?.node;
    if (currentNodeInfo) {
      console.log("finding connector", magnet, direction, currentNodeInfo?.attachedConnectors )
    let nextNodeConnector = currentNodeInfo?.attachedConnectors?.forEach(connector => {
      let start = connector.connectorStart as ConnectorEndpointEndpointNodeIdAndMagnet;
      let end = connector.connectorEnd as ConnectorEndpointEndpointNodeIdAndMagnet;

      if (start.endpointNodeId == currentNodeInfo?.id && start.magnet == magnet) {
        console.log("x keyframe", start)

        nextKeyframe = keyframes.find(keyframe => keyframe.node?.id == end.endpointNodeId) 
      } 
      if (end.endpointNodeId == currentNodeInfo?.id && end.magnet == magnet) {
        console.log("y keyframe", start)

        nextKeyframe = keyframes.find(keyframe => keyframe.node?.id == start.endpointNodeId)
      }
    });

  }
    if (nextKeyframe) {
      currentIndex = keyframes.indexOf(nextKeyframe);
    } else if (currentKeyframe && vertical) {
      currentKeyframe = reverse ? currentKeyframe.vprev : currentKeyframe.vnext;
      if (currentKeyframe) currentIndex = keyframes.indexOf(currentKeyframe);
    } else {
      currentIndex += reverse ? -1 : 1;
    }

    figma.ui.postMessage({
      index: currentIndex,
      length: currentLength,
      atEnd: currentIndex == currentLength - 1,
      pastEnd: currentIndex >= currentLength,
      atStart: currentIndex == 0
    });

    if (currentIndex < 0) currentIndex = currentLength - 1;
    if (currentIndex >= currentLength) {
      currentIndex = -1;
      return;
    }

    currentKeyframe = keyframes[currentIndex];
    let laterFrame = reverse? prevNode : currentKeyframe;
    if (laterFrame && laterFrame.node.name.endsWith("•")) duration = 0;
    if (currentKeyframe.node)
      animateToRect(currentKeyframe.node.absoluteBoundingBox as Keyframe, duration);  
  }
};


function pointInRect(p: Vector, rect: Rect | null) {
  if (!rect) return false;
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

// 

function animateToRect(rect: { x: any; y: any; width?: any; height?: any; tangentStart?: any; tangentEnd?: any; }, duration: number) {
  if (interval != null) {
    // duration = 0.0;
    clearInterval(interval); 
  }
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

  let startZoom = figma.viewport.zoom / zoomModifier;
  let endZoom = Math.min(
    (figma.viewport.bounds.width * figma.viewport.zoom   - padding * 2) / rect.width,
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
      
      try {
        figma.viewport.center = {x:x || 0, y:y || 0};
      } catch (e) {
        console.error("ERROR", e)
      }
    }
    
    // Zoom out slightly at beginning and end of animation
    let lift = Math.min(0.025, 1.0 - Math.abs(progress - 0.5)); // (Math.cos((progress - 0.5) * 2 * Math.PI) + 1)/2;
    lift = 1.0 - lift;

    let zoom = zoomFunc(progress)[0];
    
    figma.viewport.zoom = zoom * zoomModifier;// * lift;
    

    if (now >= end) {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    }
  }, 1000 / 30);
}



function lerp(start: number, end: number, p: any, f: (v: any) => any) {
  if (!f) f = (v) => v;
  return start + (end - start) * f(p);
}

/**
 * Given an array of control points, returns a function that computes the point on the bezier curve for a given parameter t.
 * @param pts An array of control points, where each control point is an array of numbers representing its coordinates.
 * @returns A function that takes a parameter t between 0 and 1, and returns an array of numbers representing the point on the bezier curve at that parameter.
 */



function bezier(pts: number[][]) {
  // console.verbose("Creating Bezier", pts)
  return function (t: number): number[] {
    // Initialize the current set of points to the input control points.
    let a: number[][] = pts;
    let b: number[][];
    
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