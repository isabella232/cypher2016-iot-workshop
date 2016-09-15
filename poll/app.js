angular.module('phone_counter', ['ui.bootstrap', 'rzModule', 'webcam'])
  .factory('Engine', function ($window, $rootScope, $q) {
    var mqttClient = mqtt.connect({port: 3000});
    var engine = {
      ready: $q.when(true),
      channelParams: {
        // the fields below are all optional
        //videoHeight: 720,
        //videoWidth: 1280,
        videoHeight: 480,
        videoWidth: 640,
        video: null // Will reference the video element on success
      },
      debugOpts: {
        video: false,
        debug: 'threshold', // Can be 'grayscale' or 'none'
        overlay: 'boxes', // 'lines', 'blobs' 
        preProc: false
      },
      preProcOpts: {
        grayscale: true,
        contrast: false,
        hysteresis: true
      },
      contrast: 128,
      threshold: [40, 70],
      a_ratio: [1,4], // ht/wd
      width: [10, 100],
      height: [20, 200],
      // Outputs
      n: 0,
      confidence: 100,
      fps: 0
    };
    var videoSources = [];
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        var p = navigator.mediaDevices.enumerateDevices().then(function(sources) {
            console.log("all possible media sources --->");
            for (var i = 0; i < sources.length; i++) {
                console.log(sources[i].label + " is " + sources[i].kind);
                if(sources[i].kind === "videoinput") 
                  videoSources.push(sources[i]);
            }
            if (videoSources.length > 1)
              engine.channelParams.source = videoSources[1];
            return true;
        });
        engine.ready = $q.when(p);
    }
    function Image(x) {
      if (x.cdim == undefined)
        this.cdim = 4;
      else
        this.cdim = x.cdim;
      if (x.range == undefined)
        this.range = [0, 255];
      else
        this.range = x.range;
      this.width = x.width;
      this.height = x.height;
      this.data = x.data;
      this.info = {};
      return this;
    }
    Image.prototype.checkIf = function (cond, fxn) {
      if (!cond)
        return this;
      var args = [];
      Array.prototype.push.apply( args, arguments );
      args.shift();args.shift();
      return fxn.apply(this, args);
    };
    Image.prototype.dumpCanvas = function (id) {
      var ctx = document.getElementById(id)
        .getContext("2d");
      var imageData = ctx.createImageData(this.width,this.height);
      var that = this;
      var quantize = function (d) {
        var ret = Math.round((d - that.range[0])/(that.range[1]-that.range[0])*255);
        if (ret > 255)
          ret = 255;
        return ret;
      };
      ctx.width = this.width;
      ctx.height = this.height;
      document.getElementById(id).width = this.width;
      document.getElementById(id).height = this.height;
      for (var i = 0; i < this.width*this.height; i++) {
        switch (this.cdim) {
          case 4:
            imageData.data[4*i+0] = (this.data[4*i+0]);
            imageData.data[4*i+1] = (this.data[4*i+1]);
            imageData.data[4*i+2] = (this.data[4*i+2]);
            imageData.data[4*i+3] = (this.data[4*i+3]);
            break;
          case 3:
            imageData.data[4*i+0] = quantize(this.data[3*i+0]);
            imageData.data[4*i+1] = quantize(this.data[3*i+1]);
            imageData.data[4*i+2] = quantize(this.data[3*i+2]);
            imageData.data[4*i+3] = 255;
            break;
          case 1:
            var qd = quantize(this.data[i]);
            imageData.data[4*i+0] = qd;
            imageData.data[4*i+1] = qd;
            imageData.data[4*i+2] = qd;
            imageData.data[4*i+3] = 255;
            break;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return this;
    };

    Image.prototype.grayscale = function () {
      var out = new Uint8ClampedArray(this.width*this.height);
      for (var i = 0; i < this.width*this.height; i++)
        out[i] = Math.floor(0.2989*this.data[4*i+0]+0.5870*this.data[4*i+1]+0.1140*this.data[4*i+2]+0.5);
      return new Image({cdim:1, range:this.range, width:this.width, height:this.height, data:out});
    };
    Image.prototype.contrast = function () {
      var out = new Uint8ClampedArray(this.width*this.height);
      var c = engine.contrast;
      var f = 259*(c+255)/255/(259-c);
      if (c == 0)
        return this;
      for (var i = 0; i < this.width*this.height; i++)
        out[i] = Math.floor(f*(this.data[i] - 128) + 128 + 0.5);
      return new Image({cdim:1, range:this.range, width:this.width, height:this.height, data:out});
    };
    Image.prototype.countBlacks = function () {
      if (this.nBlack)
        return this.nBlack;
      var w = this.width, h = this.height, n = 0;
      for (var i = 0; i < w*h; i++) {
        if (this.data[i] == 0)
          ++n;
      }
      this.nBlack = n;
      return n;
    };
    Image.prototype.expandRegions = function (n) {
      var w = this.width, h = this.height;
      var out = new Uint8ClampedArray(w*h);
      for (var i = 1; i < h-1; i++) {
        for (var j = 1; j < w-1; j++) {    
          var ndx = i*w + j;
          out[ndx] = this.data[ndx];
          if (this.data[ndx] != 0)
            continue;
          var rndx = (i-1)*w + (j-1);
          if (this.data[rndx+0] == 1) out[rndx+0] = 0;
          if (this.data[rndx+1] == 1) out[rndx+1] = 0;
          if (this.data[rndx+2] == 1) out[rndx+2] = 0;
          if (this.data[ndx-1] == 1) out[ndx-1] = 0;
          if (this.data[ndx+1] == 1) out[ndx+1] = 0;
          rndx = (i+1)*w + (j-1);
          if (this.data[rndx+0] == 1) out[rndx+0] = 0;
          if (this.data[rndx+1] == 1) out[rndx+1] = 0;
          if (this.data[rndx+2] == 1) out[rndx+2] = 0;
        }
      }
      var ret = new Image({cdim:1, range:[0,2], width:this.width, height:this.height, data:out});
      var b1 = ret.countBlacks(), b2 = this.countBlacks();
      //console.log("expand", n, b1, b2);
      if (b1-b2 < 100 || n > 10)
        return ret;
      return ret.expandRegions(n+1);
    };
    Image.prototype.hysteresis = function () {
      var w = this.width, h = this.height;
      var out = new Uint8ClampedArray(w*h);
      for (var i = 0; i < h; i++) {
        for (var j = 0; j < w; j++) {
          var ndx = i*w + j;
          if (this.data[ndx] < engine.threshold[0])
            out[ndx] = 0;
          else if (this.data[ndx] < engine.threshold[1])
            out[ndx] = 1;
          else
            out[ndx] = 2;
        }
      }
      var ret = new Image({cdim:1, range:[0,2], width:this.width, height:this.height, data:out});
      if (engine.preProcOpts.hysteresis)
        return ret.expandRegions(0);
      else
        return ret;
    };
    Image.prototype.makeBinary = function () {
      var w = this.width, h = this.height;
      var out = new Uint8ClampedArray(w*h);
      for (var i = 0; i < w*h; i++) {
        if (this.data[i] != 0)
          out[i] = 255;
      }
      return new Image({cdim:1, range:[0,2], width:this.width, height:this.height, data:out});
    };
    function getRandomColor() {
      var letters = '0123456789ABCDEF';
      var color = '#';
      for (var i = 0; i < 6; i++ ) {
          color += letters[Math.floor(Math.random() * 16)];
      }
      return color;
    }
    var outOfBounds = function(val, limits) {
      return (val < limits[0] || val > limits[1]);
    }
    tracking.ColorTracker.registerColor('black', function(r, g, b) {
      var gray = 0.2126*r + 0.7152*g  + 0.0722*b;
      //console.log(gray);
      if (gray < engine.threshold[0]) {
        return true;
      }
      return false;
    });
    function paintBoxes(boxes, color) {
      if (boxes && boxes.length) {
        var ctx = document.getElementById("debugCanvas").getContext("2d");
        boxes.forEach(function (r) {
          console.log(r);
          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x+r.width, r.y);
          ctx.lineTo(r.x+r.width, r.y+r.height);
          ctx.lineTo(r.x, r.y+r.height);
          ctx.lineTo(r.x, r.y);
          ctx.strokeStyle = color;
          ctx.stroke();
        });
      }
    }
    function findRect(boxes, box) {
      var ret;
      for (var i = 0; i < boxes[i]; i++) {
        var dx = boxes[i].cx - box.cx;
        var dy = boxes[i].cy - box.cy;
        var d = Math.sqrt(dx*dx + dy*dy);
        if (d > oDist)
          continue;
        ret = boxes[i];
        boxes.splice(i, 1);
        return ret;
      }
    }
    var colors = new tracking.ColorTracker(['black']);
    var cBoxes = [], bBoxes = [];
    var lastFrame, frameRate = 30;
    var minHold = 2000, maxHold = 4000;
    var oDist = 5, maxMiss = 3;

    colors.on('track', function(event) {
      console.log("event", event.data.length);
      var t = Date.now();
      if (lastFrame) {
        var dt = t - lastFrame;
        frameRate = 0.9*frameRate + 0.1*(1000/dt);
        console.log("frameRate="+frameRate);
      }
      lastFrame = t;
      cBoxes.forEach(function (r) {
        r.m++;
      });
      bBoxes.forEach(function (r) {
        r.m++;
      });
      if (event.data.length === 0) {
        // No colors were detected in this frame.
      } else {
        var rects = event.data.filter(function(r) {
          //console.log(r.x, r.y, r.height, r.width, r.color);
          //return true;
          return  !(outOfBounds(r.width, engine.width) ||
                outOfBounds(r.height, engine.height) ||
                outOfBounds(r.height/r.width, engine.a_ratio));
        }).map(function (r) {
          r.cx = r.x + r.width/2;
          r.cy = r.y + r.height/2;
          r.a = r.width*r.height;
          r.c = 0; // Seen count
          r.m = 0; // Miss count
          return r;
        });
        rects.forEach(function (r) {
          var or = findRect(bBoxes, r);
          if (or) {
            r.bg = true;
            if (or.a > r.a)
              r = or;
            else {
              r.c = or.c;
              r.m = 0;
            }
            r.c++;
            bBoxes.push(r);
          }
        });

        rects = rects.filter(function (r) {
          return !r.bg; // Part of BG skip
        });

        rects.forEach(function (r) {
          var or = findRect(cBoxes, r);
          if (or) {
            if (or.a > r.a)
              r = or;
            else {
              r.c = or.c;
              r.m = 0;
            }
            r.c++;
          }
          // Check if we should treat as bg
          if (r.c > maxHold/1000*frameRate)
            bBoxes.push(r);
          else
            cBoxes.push(r);
        });
      }

        bBoxes = bBoxes.filter(function (r) {
          return r.m < maxMiss;
        });
        cBoxes = cBoxes.filter(function (r) {
          return r.m < maxMiss;
        });
        var pBoxes = cBoxes.filter(function (r) {
          return r.c > minHold/1000*frameRate;
        });
        paintBoxes(pBoxes, 'green');
        paintBoxes(bBoxes, 'red');
        if (pBoxes.length != engine.n) {
          console.log("Found", event.data.length, pBoxes.length);
          engine.n = pBoxes.length;
          mqttClient.publish("poll/count", engine.n.toString());
          $rootScope.$broadcast("count", engine.n);
        }

    });

    engine.preProcess = function (frame) {
      var img = new Image(frame);
      img//.grayscale()
        .checkIf(engine.debugOpts.debug == 'grayscale', img.dumpCanvas, "debugCanvas")
        .checkIf(engine.preProcOpts.contrast, img.contrast)
        .checkIf(engine.debugOpts.debug == 'contrast', img.dumpCanvas, "debugCanvas")
        //.checkIf(engine.preProcOpts.hysteresis, img.hysteresis)
        .checkIf(engine.debugOpts.debug == 'threshold', img.dumpCanvas, "debugCanvas")
        //.makeBinary()
        .dumpCanvas("preProcCanvas")
        ;
      tracking.track('#preProcCanvas', colors, {camera: false}); 
    };
    return engine;
  })
 .controller('CounterCtrl', function ($scope, Engine, $timeout) {
    var tcanvas, video;
    $scope.engine = Engine;
    $scope.channelParams = Engine.channelParams;
    $scope.ready = false;
    Engine.ready.then(function () {
      console.log("ready");
      $scope.ready = true;
    });
    $scope.onStream = function (stream) {
      console.log("stream");
    };
    $scope.onSuccess = function () {
      console.log("success");
      tcanvas = document.createElement('canvas');
      video = Engine.channelParams.video;
    };
    $scope.onError = function (err) {
      console.error("stream error", err);
    };
    var readFrame = function () {
        tcanvas.width = video.width;
        tcanvas.height = video.height;
        var ctx = tcanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, video.width, video.height);
        return ctx.getImageData(0, 0, video.width, video.height);
    };

    $scope.$on('count', function (n) {
      console.log("count change", n);
      $scope.$apply();
    });
    (function spin() {
        if (video) // Video has started
          Engine.preProcess(readFrame());
        $timeout(spin);
    })();
 });
