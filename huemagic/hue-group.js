module.exports = function(RED)
{
	"use strict";

	function HueGroup(config)
	{
		RED.nodes.createNode(this, config);

		var scope = this;
		let bridge = RED.nodes.getNode(config.bridge);
		let path = require('path');
		let moment = require('moment');
		let rgb = require('../utils/rgb');
		let rgbHex = require('rgb-hex');
		let hexRGB = require('hex-rgb');
		let colornames = require("colornames");
		let colornamer = require('color-namer');
		let getColors = require('get-image-colors');

		//
		// CHECK CONFIG
		if(bridge == null)
		{
			this.status({fill: "red", shape: "ring", text: "hue-group.node.not-configured"});
			return false;
		}

		//
		// UPDATE STATE
		if(typeof bridge.disableupdates != 'undefined'||bridge.disableupdates == false)
		{
			this.status({fill: "grey", shape: "dot", text: "hue-group.node.init"});
		}


		if(typeof config.groupid != 'undefined')
		{
			bridge.events.on('group' + config.groupid, function(group)
			{
				var brightnessPercent = (group.brightness) ? Math.round((100/254)*group.brightness) : -1;
				var brightnessNotice = (brightnessPercent > -1) ? RED._("hue-group.node.brightness",{percent:brightnessPercent}) : "";

				if(group.allOn)
				{
					scope.status({fill: "yellow", shape: "dot", text: RED._("hue-group.node.all-on") + brightnessNotice});
				}
				else if(group.anyOn)
				{
					scope.status({fill: "yellow", shape: "ring", text: RED._("hue-group.node.some-on") + brightnessNotice});
				}
				else if(group.on)
				{
					scope.status({fill: "yellow", shape: "dot", text: RED._("hue-group.node.turned-on") + brightnessNotice});
				}
				else
				{
					scope.status({fill: "grey", shape: "dot", text: "hue-group.node.all-off"});
				}

				// SEND STATUS
				var message = {};
				message.payload = {};
				message.payload.on = group.on;
				message.payload.allOn = group.allOn;
				message.payload.anyOn = group.anyOn;
				message.payload.brightness = brightnessPercent;

				message.info = {};
				message.info.id = group.id;
				message.info.lightIds = group.lightIds.join(', ');
				message.info.name = group.name;
				message.info.type = group.type;

				if(group.modelId !== undefined)
				{
					message.info.model = {};
					message.info.model.id = group.model.id;
					message.info.model.uniqueId = group.uniqueId;
					message.info.model.manufacturer = group.model.manufacturer;
					message.info.model.name = group.model.name;
					message.info.model.type = group.model.type;
				}

				if(group.xy)
				{
					var rgbColor = rgb.convertXYtoRGB(group.xy[0], group.xy[1], group.brightness);

					message.payload.rgb = rgbColor;
					message.payload.hex = rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]);

					if(config.colornamer == true)
					{
						var cNamesArray = colornamer(rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]));
						message.payload.color = cNamesArray.basic[0]["name"];
					}
				}

				if(group.colorTemp)
				{
					message.payload.colorTemp = group.colorTemp;
				}

				message.payload.updated = moment().format();
				if(!config.skipevents) { scope.send(message); }
			});
		}
		else
		{
			scope.status({fill: "grey", shape: "dot", text: "hue-group.node.universal"});
		}


		//
		// TURN ON / OFF GROUP
		this.on('input', function(msg, send, done)
		{
			// Node-RED < 1.0
			send = send || function() { scope.send.apply(scope,arguments); }

			var context = this.context();
			var tempGroupID = (typeof msg.topic != 'undefined' && isNaN(msg.topic) == false && msg.topic.length > 0) ? parseInt(msg.topic) : config.groupid;

			// CHECK IF GROUP ID IS SET
			if(isNaN(tempGroupID))
			{
				scope.error(RED._("hue-group.node.error-no-id"));
				return false;
			}

			// SIMPLE TURN ON / OFF GROUP
			if(msg.payload === true||msg.payload === false)
			{
				bridge.client.groups.getById(tempGroupID)
				.then(group => {
					group.on = msg.payload;
					return bridge.client.groups.save(group);
				})
				.then(group => {
					scope.sendGroupStatus(group, send, done);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
			// TOGGLE ON / OFF
			else if(typeof msg.payload != 'undefined' && typeof msg.payload.toggle != 'undefined')
			{
				bridge.client.groups.getById(tempGroupID)
				.then(group => {
					group.on = (group.on) ? false : true;
					return bridge.client.groups.save(group);
				})
				.then(group => {
					scope.sendGroupStatus(group, send, done);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
			// ALERT EFFECT
			else if(typeof msg.payload != 'undefined' && typeof msg.payload.alert != 'undefined' && msg.payload.alert > 0)
			{
				bridge.client.groups.getById(tempGroupID)
				.then(group => {
					context.set('groupPreviousState', [group.on ? true : false, group.brightness, group.xy ? group.xy : false]);

					// SET ALERT COLOR
					if(group.xy)
					{
						if(typeof msg.payload.rgb != 'undefined')
						{
							group.xy = rgb.convertRGBtoXY(msg.payload.rgb, false);
						}
						else if(typeof msg.payload.hex != 'undefined')
						{
							var rgbResult = hexRGB((msg.payload.hex).toString());
							group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
						}
						else if(typeof msg.payload.color != 'undefined')
						{
							if(msg.payload.color == "random"||msg.payload.color == "any")
							{
								var randomColor = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
								var rgbResult = hexRGB(randomColor);
								group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
							}
							else
							{
								var colorHex = colornames(msg.payload.color);
								if(colorHex)
								{
									var rgbResult = hexRGB(colorHex);
									group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
								}
							}
						}
						else
						{
							group.xy = rgb.convertRGBtoXY([255,0,0], false);
						}
					}

					// ACTIVATE
					group.on = true;
					group.brightness = 254;
					group.transitionTime = 0;
					return bridge.client.groups.save(group);
				})
				.then(group => {
					// ACTIVATE ALERT
					group.alert = 'lselect';
					return bridge.client.groups.save(group);
				})
				.then(group => {
					// TURN OFF ALERT
					var groupPreviousState = context.get('groupPreviousState');
					var alertSeconds = parseInt(msg.payload.alert);

					setTimeout(function() {
						group.on = groupPreviousState[0];
						group.alert = 'none';
						group.brightness = groupPreviousState[1];
						group.transitionTime = 2;

						if(groupPreviousState[2] != false)
						{
							group.xy = groupPreviousState[2];
						}

						bridge.client.groups.save(group);
					}, alertSeconds * 1000);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
			// ANIMATION STARTED?
			else if(typeof msg.animation != 'undefined' && msg.animation.status == true && msg.animation.restore == true)
			{
				bridge.client.groups.getById(tempGroupID)
				.then(group => {
					context.set('groupPreviousState', [group.on ? true : false, group.brightness, group.xy ? group.xy : false]);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
			// ANIMATION STOPPED AND RESTORE ACTIVE?
			else if(typeof msg.animation != 'undefined' && msg.animation.status == false && msg.animation.restore == true)
			{
				bridge.client.groups.getById(tempGroupID)
				.then(group => {
					var groupPreviousState = context.get('groupPreviousState');

					group.on = groupPreviousState[0];
					group.alert = 'none';
					group.brightness = groupPreviousState[1];
					group.transitionTime = 2;

					if(groupPreviousState[2] != false)
					{
						group.xy = groupPreviousState[2];
					}

					bridge.client.groups.save(group);
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
			// EXTENDED TURN ON / OFF GROUP
			else
			{
				bridge.client.groups.getById(tempGroupID)
				.then(async (group) =>
				{
                    // SET GROUP STATE
                    if (typeof msg.payload != 'undefined' && typeof msg.payload.on != 'undefined')
                    {
                        group.on = msg.payload.on;
                    }

                    // SET BRIGHTNESS
                    if (typeof msg.payload != 'undefined' && typeof msg.payload.brightness != 'undefined')
                    {
                        if(msg.payload.brightness > 100 || msg.payload.brightness < 0) {
                            scope.error("Invalid brightness setting. Only 0 - 100 percent allowed");
                            return false;
                        }
                        else if (msg.payload.brightness == 0)
                        {
                            group.on = false;
                        }
                        else {
                            group.on = true;
                            group.brightness = Math.round((254 / 100) * parseInt(msg.payload.brightness));
                        }
                    }
                    else if (typeof msg.payload != 'undefined' && typeof msg.payload.incrementBrightness != 'undefined')
					{
                        if(msg.payload.incrementBrightness > 0 && typeof msg.payload.ignoreOffLights == 'undefined')
                        {
                            group.on = true;
                        }
                        group.incrementBrightness = Math.round((254/100)*parseInt(msg.payload.incrementBrightness));
					}

					// SET HUMAN READABLE COLOR
					if(typeof msg.payload != 'undefined' && typeof msg.payload.color != 'undefined' && typeof group.xy != 'undefined')
					{
						if(msg.payload.color == "random"||msg.payload.color == "any")
						{
							var randomColor = '#'+(Math.random()*0xFFFFFF<<0).toString(16);
							var rgbResult = hexRGB(randomColor);
							group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
						}
						else
						{
							var colorHex = colornames(msg.payload.color);
							if(colorHex)
							{
								var rgbResult = hexRGB(colorHex);
								group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
							}
						}
					}

					// SET RGB COLOR
					if(typeof msg.payload != 'undefined' && typeof msg.payload.rgb != 'undefined' && typeof group.xy != 'undefined')
					{
						group.xy = rgb.convertRGBtoXY(msg.payload.rgb, false);
					}

					// SET HEX COLOR
					if(typeof msg.payload != 'undefined' && typeof msg.payload.hex != 'undefined' && typeof group.xy != 'undefined')
					{
						var rgbResult = hexRGB((msg.payload.hex).toString());
						group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
					}

					// SET SATURATION
					if(typeof msg.payload != 'undefined' && typeof msg.payload.saturation != 'undefined' && typeof group.saturation != 'undefined')
					{
						if(msg.payload.saturation > 100 || msg.payload.saturation < 0)
						{
							scope.error(RED._("error-invalid-sat"), msg);
							return false;
						}
						else
						{
							group.saturation = Math.round((254/100)*parseInt(msg.payload.saturation));
						}
					}

					// SET COLOR TEMPERATURE
					if(typeof msg.payload != 'undefined' && typeof msg.payload.colorTemp != 'undefined' && typeof group.colorTemp != 'undefined')
					{
						let colorTemp = parseInt(msg.payload.colorTemp);
						if(colorTemp >= 153 && colorTemp <= 500)
						{
							group.colorTemp = parseInt(msg.payload.colorTemp);
						}
						else
						{
							scope.error(RED._("error-invalid-temp"), msg);
							return false;
						}
					}

					// SET TRANSITION TIME
					if(typeof msg.payload != 'undefined' && typeof msg.payload.transitionTime != 'undefined')
					{
						group.transitionTime = parseFloat(msg.payload.transitionTime);
					}

					// SET COLORLOOP EFFECT
					if(typeof msg.payload != 'undefined' && typeof msg.payload.colorloop != 'undefined' && msg.payload.colorloop > 0 && typeof group.xy != 'undefined')
					{
						group.effect = 'colorloop';

						// DISABLE AFTER
						setTimeout(function() {
							group.effect = 'none';
							bridge.client.groups.save(group)
						}, parseFloat(msg.payload.colorloop)*1000);
					}

					// SET DOMINANT COLORS FROM IMAGE
					if(typeof msg.payload != 'undefined' && typeof msg.payload.image != 'undefined' && typeof group.xy != 'undefined')
					{
						var colors = await getColors(msg.payload.image);
						if(colors.length > 0)
						{
							var colorsHEX = colors.map(color => color.hex());
							var rgbResult = hexRGB(colorsHEX[0]);
							group.xy = rgb.convertRGBtoXY([rgbResult.red, rgbResult.green, rgbResult.blue], false);
						}
					}

					return bridge.client.groups.save(group);
				})
				.then(group => {
					// TRANSITION TIME? WAIT…
					if(typeof msg.payload != 'undefined' && typeof msg.payload.transitionTime != 'undefined')
					{
						setTimeout(function() {
							scope.sendGroupStatus(group, send, done);
						}, parseFloat(msg.payload.transitionTime)*1010);
					}
					else
					{
						scope.sendGroupStatus(group, send, done);
					}
				})
				.catch(error => {
					scope.error(error, msg);
					scope.status({fill: "red", shape: "ring", text: "hue-group.node.error-input"});
					if(done) { done(error); }
				});
			}
		});


		//
		// SEND GROUP STATUS
		this.sendGroupStatus = function(group, send, done)
		{
			var scope = this;
			var uniqueStatus = ((group.on) ? "1" : "0") + group.brightness + group.hue + group.saturation + group.colorTemp + ((group.anyOn) ? "1" : "0") + ((group.allOn) ? "1" : "0");
			var brightnessPercent = Math.round((100/254)*group.brightness);
			var brightnessNotice = (brightnessPercent > -1) ? RED._("hue-group.node.brightness",{percent:brightnessPercent}) : "";

			if(group.allOn)
			{
				scope.status({fill: "yellow", shape: "dot", text: RED._("hue-group.node.all-on") + brightnessNotice});
			}
			else if(group.anyOn)
			{
				scope.status({fill: "yellow", shape: "ring", text: RED._("hue-group.node.some-on") + brightnessNotice});
			}
			else if(group.on)
			{
				scope.status({fill: "yellow", shape: "dot", text: RED._("hue-group.node.turned-on") + brightnessNotice});
			}
			else
			{
				scope.status({fill: "grey", shape: "dot", text: "hue-group.node.all-off"});
			}

			// SEND STATUS
			var message = {};
			message.payload = {};
			message.payload.on = group.on;
			message.payload.allOn = group.allOn;
			message.payload.anyOn = group.anyOn;
			message.payload.brightness = brightnessPercent;

			message.info = {};
			message.info.id = group.id;
			message.info.lightIds = group.lightIds.join(', ');
			message.info.name = group.name;
			message.info.type = group.type;
			message.info.class = group.class;

			if(group.modelId !== undefined)
			{
				message.info.model = {};
				message.info.model.id = group.model.id;
				message.info.model.uniqueId = group.uniqueId;
				message.info.model.manufacturer = group.model.manufacturer;
				message.info.model.name = group.model.name;
				message.info.model.type = group.model.type;
			}

			if(group.xy)
			{
				var rgbColor = rgb.convertXYtoRGB(group.xy[0], group.xy[1], group.brightness);

				message.payload.rgb = rgbColor;
				message.payload.hex = rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]);

				if(config.colornamer == true)
				{
					var cNamesArray = colornamer(rgbHex(rgbColor[0], rgbColor[1], rgbColor[2]));
					message.payload.color = cNamesArray.basic[0]["name"];
				}
			}

			if(group.colorTemp)
			{
				message.payload.colorTemp = group.colorTemp;
			}

			message.payload.updated = moment().format();
			if(!config.skipevents) { send(message); }
			if(done) { done(); }
		}

		//
		// CLOSE NODE / REMOVE EVENT LISTENER
		this.on('close', function()
		{
			bridge.events.removeAllListeners('group' + config.groupid);
		});
	}

	RED.nodes.registerType("hue-group", HueGroup);
}
